/**
 * beam host — the JSON-over-HTTP routes from docs/beam.md's auth surface.
 * Split out of host.ts so the server's lifecycle and the route bodies stay
 * independently readable; every function here takes its dependencies
 * explicitly rather than reaching into a Host instance.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { AuthError, type MutualAuth } from './auth.js';
import { readJsonBody, sendJson, BodyTooLargeError } from './http-json.js';
import { isLabel } from './identifiers.js';
import { derivePeerId, type Identity } from './identity.js';
import type { PeerTable } from './peer-table.js';
import type { SingleUseSecrets } from './secrets.js';

export const DESCRIPTOR_PATH = '/.well-known/beam/host';
export const PROTOCOL_VERSION = 1;

export interface HostDescriptor {
  peerId: string;
  label: string;
  protocol: number;
  capabilities: string[];
}

const AUTH_STATUS: Record<AuthError['kind'], number> = {
  'unknown-peer': 404,
  'revoked-peer': 403,
  'bad-signature': 401,
  'stale-challenge': 401,
  'spent-ticket': 401,
  'host-key-mismatch': 401, // never raised host-side; listed for completeness.
  'host-id-mismatch': 401, // client-side only; listed for completeness.
};

export interface RouteContext {
  identity: Identity;
  peers: PeerTable;
  auth: MutualAuth;
  pairingTokens: SingleUseSecrets<undefined>;
  endpoints: string[];
  capabilities: string[];
  log: (message: string) => void;
}

async function readBody(
  req: IncomingMessage,
  res: ServerResponse
): Promise<Record<string, unknown> | null> {
  try {
    return await readJsonBody(req);
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      sendJson(res, 413, { error: error.message });
    } else {
      sendJson(res, 400, { error: 'malformed JSON body' });
    }
    return null;
  }
}

export function handleDescriptor(ctx: RouteContext, res: ServerResponse): void {
  const descriptor: HostDescriptor = {
    peerId: ctx.identity.peerId,
    label: ctx.identity.label,
    protocol: PROTOCOL_VERSION,
    capabilities: ctx.capabilities,
  };
  sendJson(res, 200, descriptor);
}

export async function handlePair(
  ctx: RouteContext,
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const body = await readBody(req, res);
  if (!body) return;
  const { token, publicKeyPem, label, endpoints } = body as {
    token?: unknown;
    publicKeyPem?: unknown;
    label?: unknown;
    endpoints?: unknown;
  };
  if (
    typeof token !== 'string' ||
    typeof publicKeyPem !== 'string' ||
    typeof label !== 'string'
  ) {
    sendJson(res, 400, {
      error: 'token, publicKeyPem, and label are required',
    });
    return;
  }
  // The label is chosen by the caller and ends up in this machine's logs,
  // in the JSON lines its local socket emits, and on a terminal. Refused
  // rather than sanitised (identifiers.ts).
  if (!isLabel(label)) {
    sendJson(res, 400, { error: 'invalid-label' });
    return;
  }
  if (!ctx.pairingTokens.consume(token).valid) {
    sendJson(res, 401, {
      error: 'invalid, expired, or already-used pairing token',
    });
    return;
  }
  const wanted = {
    peerId: derivePeerId(publicKeyPem),
    label,
    publicKeyPem,
    endpoints: Array.isArray(endpoints)
      ? endpoints.filter((e): e is string => typeof e === 'string')
      : [],
  };
  // The accepting side gates a re-pair exactly as the dialling side does
  // (docs/beam.md: "Re-pairing an existing peer replaces its key only with
  // `--force`"). A public key is not a secret, so anyone holding a live
  // pairing token and a peer's key could otherwise silently rewrite that
  // peer's record — and `endpoints` is where the mailbox flusher later
  // dials. The token is spent either way, which is what stops this being
  // an oracle for whether a given peer is already known.
  if (!replacesExisting(body) && conflictsWithStored(ctx, wanted)) {
    sendJson(res, 409, { error: 'already-paired' });
    return;
  }
  const peerId = ctx.peers.upsert(wanted).peerId;
  ctx.log(`paired with ${peerId}`);
  sendJson(res, 201, {
    peerId: ctx.identity.peerId,
    label: ctx.identity.label,
    publicKeyPem: ctx.identity.publicKeyPem,
    endpoints: ctx.endpoints,
    protocol: PROTOCOL_VERSION,
  });
}

/** An explicit `replace: true` in the pair body — the wire form of the
 * CLI's `--force`, and the only thing that lets a re-pair overwrite a
 * record this machine already holds. */
function replacesExisting(body: Record<string, unknown>): boolean {
  return body['replace'] === true;
}

/** Whether storing `wanted` would change what this machine already holds
 * for that peer. A label collision is not a conflict: labels are local
 * display names the table already disambiguates. */
function conflictsWithStored(
  ctx: RouteContext,
  wanted: { peerId: string; publicKeyPem: string; endpoints: string[] }
): boolean {
  const existing = ctx.peers.get(wanted.peerId);
  if (!existing) return false;
  return (
    existing.publicKeyPem !== wanted.publicKeyPem ||
    existing.endpoints.join('\u0000') !== wanted.endpoints.join('\u0000')
  );
}

export function handleChallenge(
  ctx: RouteContext,
  peerId: string,
  res: ServerResponse
): void {
  const peer = ctx.peers.get(peerId);
  if (!peer) {
    sendJson(res, 404, { error: 'unknown-peer' });
    return;
  }
  // A5: a revoked peer gets no nonce to sign, matching /session's own check.
  if (peer.revoked) {
    sendJson(res, 403, { error: 'revoked-peer' });
    return;
  }
  // Minted for this peer and no other: the nonce carries `peer.peerId`,
  // and `/session` refuses it from anyone else. The route is open to every
  // known peer, so a fungible nonce is one any peer can fetch in a third
  // party's name and have that party sign.
  sendJson(res, 200, { challenge: ctx.auth.issueChallenge(peer.peerId) });
}

export async function handleSession(
  ctx: RouteContext,
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const body = await readBody(req, res);
  if (!body) return;
  const { peerId, challenge, signature, clientChallenge } = body as Record<
    string,
    unknown
  >;
  if (
    typeof peerId !== 'string' ||
    typeof challenge !== 'string' ||
    typeof signature !== 'string' ||
    typeof clientChallenge !== 'string'
  ) {
    sendJson(res, 400, {
      error: 'peerId, challenge, signature, and clientChallenge are required',
    });
    return;
  }
  try {
    const result = ctx.auth.proveSession({
      peerId,
      challenge,
      signature,
      clientChallenge,
    });
    ctx.peers.touch(peerId);
    sendJson(res, 200, result);
  } catch (error) {
    if (error instanceof AuthError) {
      sendJson(res, AUTH_STATUS[error.kind], { error: error.kind });
      return;
    }
    throw error;
  }
}

export function handleRtc(res: ServerResponse): void {
  sendJson(res, 501, { error: 'this host was built without WebRTC support' });
}
