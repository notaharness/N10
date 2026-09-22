import { generateKeyPairSync } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { connect, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { signNonce, verifySignature } from './auth.js';
import {
  hostTranscript,
  sessionTranscript,
  wsTranscript,
} from './handshake-transcript.js';
import { derivePeerId, loadOrCreateIdentity } from './identity.js';
import { PeerTable } from './peer-table.js';
import { DESCRIPTOR_PATH, Host } from './host.js';
import { encodeFrame, FrameType } from './protocol.js';

let dir: string;
let host: Host;

interface ClientIdentity {
  peerId: string;
  publicKeyPem: string;
  privateKeyPem: string;
}

function clientKeyPair(): ClientIdentity {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey
    .export({ type: 'spki', format: 'pem' })
    .toString();
  const privateKeyPem = privateKey
    .export({ type: 'pkcs8', format: 'pem' })
    .toString();
  return { peerId: derivePeerId(publicKeyPem), publicKeyPem, privateKeyPem };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'beam-host-'));
});

afterEach(async () => {
  await host?.close();
  rmSync(dir, { recursive: true, force: true });
});

async function startHost(
  overrides: Partial<{ hostname: string; log: (m: string) => void }> = {}
): Promise<Host> {
  const identity = loadOrCreateIdentity(dir, { hostname: () => 'host-box' });
  const peers = new PeerTable(dir);
  host = new Host({ identity, peers, port: 0, ...overrides });
  await host.listen();
  return host;
}

/** The two machines every handshake signature names. */
function partiesFor(h: Host, client: ClientIdentity) {
  return { hostPeerId: h.identity.peerId, clientPeerId: client.peerId };
}

/** The `/ws` URL a legitimate client builds: the ticket, plus a signature
 * over the ws transcript proving the key the host stored at pairing. */
function wsUrlFor(
  h: Host,
  client: ClientIdentity,
  ticket: string,
  overrides: { proof?: string } = {}
): string {
  const url = new URL(`ws://${h.hostname}:${h.port}/ws`);
  url.searchParams.set('ticket', ticket);
  const proof =
    overrides.proof ??
    signNonce(client.privateKeyPem, wsTranscript(partiesFor(h, client), ticket));
  if (proof) url.searchParams.set('proof', proof);
  return url.toString();
}

/** Drive the full challenge/session exchange and return the ticket. */
async function ticketFor(h: Host, client: ClientIdentity): Promise<string> {
  const { challenge } = (await (
    await fetch(`${h.baseUrl}/challenge/${client.peerId}`)
  ).json()) as { challenge: string };
  const res = await fetch(`${h.baseUrl}/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      peerId: client.peerId,
      challenge,
      signature: signNonce(
        client.privateKeyPem,
        sessionTranscript(partiesFor(h, client), challenge)
      ),
      clientChallenge: 'x',
    }),
  });
  return ((await res.json()) as { ticket: string }).ticket;
}

/** Send a raw upgrade request with an arbitrary request-target — something
 * no WebSocket client would build — and return whatever the host wrote back
 * before the socket closed. */
function rawUpgrade(h: Host, target: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let response = '';
    const socket = connect(h.port, h.hostname, () => {
      socket.write(
        `GET ${target} HTTP/1.1\r\n` +
          `Host: ${h.hostname}\r\n` +
          'Upgrade: websocket\r\n' +
          'Connection: Upgrade\r\n' +
          'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n' +
          'Sec-WebSocket-Version: 13\r\n\r\n'
      );
    });
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      response += chunk;
    });
    socket.on('error', reject);
    socket.on('close', () => resolve(response));
  });
}

/** A WebSocket peer that speaks the wire by hand and, unlike every `ws`
 * client, never answers a Close frame. That refusal is the whole point: a
 * graceful close is a handshake, and `ws` waits out its 30s `closeTimeout`
 * for an answer that is never coming while inbound frames keep arriving. */
async function hostilePeer(url: string): Promise<{
  send(bytes: Uint8Array): void;
  closed: Promise<void>;
}> {
  const target = new URL(url);
  const socket = connect(Number(target.port), target.hostname);
  const closed = new Promise<void>((resolve) => socket.on('close', resolve));
  socket.on('error', () => undefined);
  await new Promise<void>((resolve, reject) => {
    socket.on('connect', () => {
      socket.write(
        `GET ${target.pathname}${target.search} HTTP/1.1\r\n` +
          `Host: ${target.host}\r\n` +
          'Upgrade: websocket\r\n' +
          'Connection: Upgrade\r\n' +
          'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n' +
          'Sec-WebSocket-Version: 13\r\n\r\n'
      );
    });
    // Everything after the 101 is frames this peer deliberately ignores,
    // the server's Close frame included.
    socket.once('data', (chunk: Buffer) => {
      const status = chunk.toString('latin1').split('\r\n')[0];
      if (status.includes('101')) resolve();
      else reject(new Error(`upgrade refused: ${status}`));
    });
    socket.once('error', reject);
  });
  return {
    send: (bytes) => {
      // One masked binary frame; every payload these tests send is short
      // enough for the 7-bit length form.
      const mask = Buffer.from([0x0a, 0x0b, 0x0c, 0x0d]);
      const masked = Buffer.from(bytes);
      for (let i = 0; i < masked.length; i += 1) masked[i] ^= mask[i % 4];
      socket.write(
        Buffer.concat([Buffer.from([0x82, 0x80 | masked.length]), mask, masked])
      );
    },
    closed,
  };
}

/** An Open frame for `name` on a stream id an acceptor accepts as the
 * peer's to allocate (odd). */
function openFrame(streamId: number, name: string): Uint8Array {
  return encodeFrame({
    type: FrameType.Open,
    streamId,
    seq: 0,
    payload: new TextEncoder().encode(name),
  });
}

function until(predicate: () => boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 2000;
    const tick = (): void => {
      if (predicate()) resolve();
      else if (Date.now() > deadline) reject(new Error('timed out waiting'));
      else setTimeout(tick, 5);
    };
    tick();
  });
}

/** Whether a `/ws` upgrade to `url` completes. */
function upgrades(url: string): Promise<boolean> {
  const socket = new WebSocket(url);
  return new Promise<boolean>((resolve) => {
    socket.once('open', () => {
      socket.close();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

describe('Host HTTP surface', () => {
  it('defaults to binding loopback', async () => {
    const h = await startHost();
    expect(h.hostname).toBe('127.0.0.1');
  });

  it('logs when told to bind a non-loopback interface', async () => {
    const logs: string[] = [];
    await startHost({ hostname: '0.0.0.0', log: (m) => logs.push(m) });
    expect(logs.some((m) => m.includes('0.0.0.0'))).toBe(true);
  });

  it('serves its own descriptor', async () => {
    const h = await startHost();
    const res = await fetch(`${h.baseUrl}/.well-known/beam/host`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      peerId: string;
      label: string;
      protocol: number;
      capabilities: string[];
    };
    expect(body.peerId).toBe(h.identity.peerId);
    expect(body.label).toBe('host-box');
    expect(Array.isArray(body.capabilities)).toBe(true);
  });

  it("pairing registers the caller and returns this host's own identity, symmetrically", async () => {
    const h = await startHost();
    const client = clientKeyPair();
    const token = h.issuePairingToken();

    const res = await fetch(`${h.baseUrl}/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        token,
        publicKeyPem: client.publicKeyPem,
        label: 'laptop',
        endpoints: [],
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      peerId: string;
      label: string;
      publicKeyPem: string;
      endpoints: string[];
    };
    expect(body.peerId).toBe(h.identity.peerId);
    expect(body.publicKeyPem).toBe(h.identity.publicKeyPem);

    const stored = h.peers.get(client.peerId);
    expect(stored?.label).toBe('laptop');
    expect(stored?.publicKeyPem).toBe(client.publicKeyPem);
  });

  it('setEndpoints changes what a pairing response advertises, without a restart', async () => {
    const h = await startHost();
    const client = clientKeyPair();
    const before = await fetch(`${h.baseUrl}/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        token: h.issuePairingToken(),
        publicKeyPem: client.publicKeyPem,
        label: 'laptop',
        endpoints: [],
      }),
    });
    expect(
      ((await before.json()) as { endpoints: string[] }).endpoints
    ).toEqual([]);

    h.setEndpoints([h.baseUrl]);
    const after = await fetch(`${h.baseUrl}/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        token: h.issuePairingToken(),
        publicKeyPem: client.publicKeyPem,
        label: 'laptop',
        endpoints: [],
      }),
    });
    expect(((await after.json()) as { endpoints: string[] }).endpoints).toEqual(
      [h.baseUrl]
    );
  });

  it('a pairing token works exactly once', async () => {
    const h = await startHost();
    const client = clientKeyPair();
    const token = h.issuePairingToken();
    const pair = () =>
      fetch(`${h.baseUrl}/pair`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          token,
          publicKeyPem: client.publicKeyPem,
          label: 'laptop',
          endpoints: [],
        }),
      });
    expect((await pair()).status).toBe(201);
    expect((await pair()).status).toBe(401);
  });

  it('a re-pair that would change a stored peer is refused without replace', async () => {
    const h = await startHost();
    const client = clientKeyPair();
    const post = (body: Record<string, unknown>) =>
      fetch(`${h.baseUrl}/pair`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          token: h.issuePairingToken(),
          publicKeyPem: client.publicKeyPem,
          label: 'laptop',
          ...body,
        }),
      });

    expect((await post({ endpoints: ['http://real:9000'] })).status).toBe(201);
    // A public key is not a secret. Anyone holding a live pairing token
    // and this peer's key could otherwise point `endpoints` — where the
    // mailbox flusher dials — anywhere they liked.
    const hijack = await post({ endpoints: ['http://attacker:1'] });
    expect(hijack.status).toBe(409);
    expect(await hijack.json()).toEqual({ error: 'already-paired' });
    expect(h.peers.get(client.peerId)?.endpoints).toEqual(['http://real:9000']);

    // Re-pairing with what is already stored is not a change, so it is not
    // a conflict; and an explicit replace still goes through.
    expect((await post({ endpoints: ['http://real:9000'] })).status).toBe(201);
    expect(
      (await post({ endpoints: ['http://moved:9100'], replace: true })).status
    ).toBe(201);
    expect(h.peers.get(client.peerId)?.endpoints).toEqual([
      'http://moved:9100',
    ]);
  });

  it('a refused re-pair still spends its token, so the endpoint is no oracle', async () => {
    const h = await startHost();
    const client = clientKeyPair();
    const post = (token: string, endpoints: string[]) =>
      fetch(`${h.baseUrl}/pair`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          token,
          publicKeyPem: client.publicKeyPem,
          label: 'laptop',
          endpoints,
        }),
      });
    expect(
      (await post(h.issuePairingToken(), ['http://real:9000'])).status
    ).toBe(201);
    const token = h.issuePairingToken();
    expect((await post(token, ['http://attacker:1'])).status).toBe(409);
    expect((await post(token, ['http://attacker:1'])).status).toBe(401);
  });

  it('refuses a pairing label that would land in a log or a path', async () => {
    const h = await startHost();
    const client = clientKeyPair();
    const res = await fetch(`${h.baseUrl}/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        token: h.issuePairingToken(),
        publicKeyPem: client.publicKeyPem,
        label: '../../etc/passwd',
        endpoints: [],
      }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid-label' });
    expect(h.peers.get(client.peerId)).toBeUndefined();
  });

  it('rejects a body over the 64 KiB cap', async () => {
    const h = await startHost();
    const res = await fetch(`${h.baseUrl}/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'x', publicKeyPem: 'x'.repeat(70 * 1024) }),
    });
    expect(res.status).toBe(413);
  });

  it('the full mutual-auth round trip: challenge, session, and a ws upgrade with the ticket', async () => {
    const h = await startHost();
    const client = clientKeyPair();
    h.peers.upsert({
      peerId: client.peerId,
      label: 'laptop',
      publicKeyPem: client.publicKeyPem,
      endpoints: [],
    });

    const challengeRes = await fetch(`${h.baseUrl}/challenge/${client.peerId}`);
    expect(challengeRes.status).toBe(200);
    const { challenge } = (await challengeRes.json()) as { challenge: string };

    const signature = signNonce(
      client.privateKeyPem,
      sessionTranscript(partiesFor(h, client), challenge)
    );
    const sessionRes = await fetch(`${h.baseUrl}/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        peerId: client.peerId,
        challenge,
        signature,
        clientChallenge: 'nonce-x',
      }),
    });
    expect(sessionRes.status).toBe(200);
    const { ticket, hostSignature } = (await sessionRes.json()) as {
      ticket: string;
      hostSignature: string;
    };
    expect(
      verifySignature(
        h.identity.publicKeyPem,
        hostTranscript(partiesFor(h, client), 'nonce-x'),
        hostSignature
      )
    ).toBe(true);

    const socket = new WebSocket(wsUrlFor(h, client, ticket));
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve());
      socket.once('error', reject);
    });
    expect(h.connections.get(client.peerId)).toBeDefined();
    socket.close();
  });

  it('GET /challenge/:peerId 404s for an unknown peer', async () => {
    const h = await startHost();
    const res = await fetch(`${h.baseUrl}/challenge/nope`);
    expect(res.status).toBe(404);
  });

  it('POST /session distinguishes unknown-peer, revoked-peer, bad-signature and stale-challenge', async () => {
    const h = await startHost();
    const client = clientKeyPair();
    h.peers.upsert({
      peerId: client.peerId,
      label: 'laptop',
      publicKeyPem: client.publicKeyPem,
      endpoints: [],
    });

    const session = (body: Record<string, unknown>) =>
      fetch(`${h.baseUrl}/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

    const unknown = await session({
      peerId: 'nope',
      challenge: 'x',
      signature: 'x',
      clientChallenge: 'x',
    });
    expect(unknown.status).toBe(404);
    expect(((await unknown.json()) as { error: string }).error).toBe(
      'unknown-peer'
    );

    const forgedChallenge = 'never-issued-by-this-host';
    const validSignatureOverForgedChallenge = signNonce(
      client.privateKeyPem,
      sessionTranscript(partiesFor(h, client), forgedChallenge)
    );
    const staleRes = await session({
      peerId: client.peerId,
      challenge: forgedChallenge,
      signature: validSignatureOverForgedChallenge,
      clientChallenge: 'x',
    });
    expect(staleRes.status).toBe(401);
    expect(((await staleRes.json()) as { error: string }).error).toBe(
      'stale-challenge'
    );

    const { challenge } = (await (
      await fetch(`${h.baseUrl}/challenge/${client.peerId}`)
    ).json()) as {
      challenge: string;
    };
    const badSig = await session({
      peerId: client.peerId,
      challenge,
      signature: 'not-a-real-signature',
      clientChallenge: 'x',
    });
    expect(badSig.status).toBe(401);
    expect(((await badSig.json()) as { error: string }).error).toBe(
      'bad-signature'
    );

    // Fetch a legitimate challenge *before* revoking, so this exercises
    // /session's own revocation check independently of /challenge's — the
    // window A5 closes is exactly a peer revoked between challenge issuance
    // and session completion (e.g. inside a stale ticket's 30s life).
    const { challenge: challenge2 } = (await (
      await fetch(`${h.baseUrl}/challenge/${client.peerId}`)
    ).json()) as {
      challenge: string;
    };
    const signature2 = signNonce(
      client.privateKeyPem,
      sessionTranscript(partiesFor(h, client), challenge2)
    );
    h.peers.revoke(client.peerId);
    const revokedRes = await session({
      peerId: client.peerId,
      challenge: challenge2,
      signature: signature2,
      clientChallenge: 'x',
    });
    expect(revokedRes.status).toBe(403);
    expect(((await revokedRes.json()) as { error: string }).error).toBe(
      'revoked-peer'
    );
  });

  it('A5: /challenge/:peerId also 403s a revoked peer, not just /session', async () => {
    const h = await startHost();
    const client = clientKeyPair();
    h.peers.upsert({
      peerId: client.peerId,
      label: 'laptop',
      publicKeyPem: client.publicKeyPem,
      endpoints: [],
    });
    h.peers.revoke(client.peerId);
    const res = await fetch(`${h.baseUrl}/challenge/${client.peerId}`);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe(
      'revoked-peer'
    );
  });

  it('A5: revoking a peer with a live connection drops it', async () => {
    const h = await startHost();
    const client = clientKeyPair();
    h.peers.upsert({
      peerId: client.peerId,
      label: 'laptop',
      publicKeyPem: client.publicKeyPem,
      endpoints: [],
    });
    const ticket = await ticketFor(h, client);
    const socket = new WebSocket(wsUrlFor(h, client, ticket));
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve());
      socket.once('error', reject);
    });
    expect(h.connections.get(client.peerId)).toBeDefined();

    const closed = new Promise<void>((resolve) =>
      socket.once('close', resolve)
    );
    h.revoke(client.peerId);
    await closed;
    expect(h.connections.get(client.peerId)).toBeUndefined();
  });

  it('A5: revocation drops a peer that refuses to close, and opens nothing after it', async () => {
    const h = await startHost();
    const client = clientKeyPair();
    h.peers.upsert({
      peerId: client.peerId,
      label: 'laptop',
      publicKeyPem: client.publicKeyPem,
      endpoints: [],
    });
    const opened: string[] = [];
    h.registry.register('probe', (stream) => {
      opened.push(stream.name);
      stream.control({ kind: 'opened' });
    });

    const peer = await hostilePeer(
      wsUrlFor(h, client, await ticketFor(h, client))
    );
    await until(() => h.connections.get(client.peerId) !== undefined);
    // This hand-rolled peer really does open streams — otherwise the
    // assertions after the revoke would pass for the wrong reason.
    peer.send(openFrame(1, 'probe'));
    await until(() => opened.length === 1);

    h.revoke(client.peerId);

    // A graceful close would leave this peer the whole of `ws`'s 30s close
    // timeout, opening a fresh shell per Open frame for as long as it
    // declined to answer. The connection is gone now instead.
    const outcome = await Promise.race([
      peer.closed.then(() => 'dropped'),
      new Promise((resolve) => setTimeout(() => resolve('still up'), 1500)),
    ]);
    expect(outcome).toBe('dropped');
    expect(h.connections.get(client.peerId)).toBeUndefined();

    peer.send(openFrame(3, 'probe'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(opened).toEqual(['probe']);
  });

  it('A5: revoking inside the ticket window still blocks the upgrade', async () => {
    const h = await startHost();
    const client = clientKeyPair();
    h.peers.upsert({
      peerId: client.peerId,
      label: 'laptop',
      publicKeyPem: client.publicKeyPem,
      endpoints: [],
    });
    const { challenge } = (await (
      await fetch(`${h.baseUrl}/challenge/${client.peerId}`)
    ).json()) as { challenge: string };
    const signature = signNonce(client.privateKeyPem, challenge);
    const sessionRes = await fetch(`${h.baseUrl}/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        peerId: client.peerId,
        challenge,
        signature,
        clientChallenge: 'x',
      }),
    });
    const { ticket } = (await sessionRes.json()) as { ticket: string };
    // Revoke *after* the ticket was minted but *before* it is redeemed — the
    // exact window a ticket alone cannot close.
    h.peers.revoke(client.peerId);
    expect(await upgrades(wsUrlFor(h, client, ticket))).toBe(false);
  });

  it('the ws upgrade needs proof of the key, not just the ticket', async () => {
    const h = await startHost();
    const client = clientKeyPair();
    const attacker = clientKeyPair();
    h.peers.upsert({
      peerId: client.peerId,
      label: 'laptop',
      publicKeyPem: client.publicKeyPem,
      endpoints: [],
    });

    // The transport is not encrypted, so the ticket is readable by anyone
    // on the path. Possession of it alone must not be enough.
    expect(
      await upgrades(
        await ticketFor(h, client).then((t) =>
          wsUrlFor(h, client, t, { proof: '' })
        )
      )
    ).toBe(false);

    expect(
      await upgrades(
        await ticketFor(h, client).then((t) =>
          wsUrlFor(h, client, t, {
            proof: signNonce(
              attacker.privateKeyPem,
              wsTranscript(partiesFor(h, client), t)
            ),
          })
        )
      )
    ).toBe(false);

    // A signature over the bare ticket is not a signature over the ws
    // transcript: the context tag keeps this proof and /session's
    // challenge proof from standing in for one another.
    expect(
      await upgrades(
        await ticketFor(h, client).then((t) =>
          wsUrlFor(h, client, t, {
            proof: signNonce(client.privateKeyPem, t),
          })
        )
      )
    ).toBe(false);

    expect(
      await upgrades(wsUrlFor(h, client, await ticketFor(h, client)))
    ).toBe(true);
  });

  it('a bad proof does not spend the ticket it was presented with', async () => {
    const h = await startHost();
    const client = clientKeyPair();
    const attacker = clientKeyPair();
    h.peers.upsert({
      peerId: client.peerId,
      label: 'laptop',
      publicKeyPem: client.publicKeyPem,
      endpoints: [],
    });
    const ticket = await ticketFor(h, client);

    // An attacker who read the ticket off the wire races the legitimate
    // client with a garbage proof. If the ticket were consumed before the
    // proof was checked, that race alone would burn it.
    expect(
      await upgrades(
        wsUrlFor(h, client, ticket, {
          proof: signNonce(
            attacker.privateKeyPem,
            wsTranscript(partiesFor(h, client), ticket)
          ),
        })
      )
    ).toBe(false);
    expect(await upgrades(wsUrlFor(h, client, ticket))).toBe(true);
  });

  it('an oversized ws message is refused by the transport, not buffered whole', async () => {
    const h = await startHost();
    const client = clientKeyPair();
    h.peers.upsert({
      peerId: client.peerId,
      label: 'laptop',
      publicKeyPem: client.publicKeyPem,
      endpoints: [],
    });
    const socket = new WebSocket(
      wsUrlFor(h, client, await ticketFor(h, client))
    );
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve());
      socket.once('error', reject);
    });
    const closed = new Promise<number>((resolve) => {
      socket.once('close', (code) => resolve(code));
      socket.once('error', () => undefined);
    });
    // `ws` defaults to 100 MiB per message, so without a cap this would be
    // allocated and concatenated in full before the frame decoder could
    // look at the length field it would have rejected.
    socket.send(Buffer.alloc(2 * 1024 * 1024));
    expect(await closed).toBe(1009); // "message too big"
  });

  it('POST /rtc reports webrtc as unsupported in this phase', async () => {
    const h = await startHost();
    const res = await fetch(`${h.baseUrl}/rtc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ticket: 'whatever', sdp: 'x', type: 'offer' }),
    });
    expect(res.status).toBe(501);
  });

  it('a malformed upgrade request-target is refused without taking the node down', async () => {
    const h = await startHost();
    const client = clientKeyPair();
    h.peers.upsert({
      peerId: client.peerId,
      label: 'laptop',
      publicKeyPem: client.publicKeyPem,
      endpoints: [],
    });
    // A live peer whose connection must survive the attempt: the crash this
    // guards against is pre-auth and node-wide, not scoped to one socket.
    const victim = new WebSocket(
      wsUrlFor(h, client, await ticketFor(h, client))
    );
    await new Promise<void>((resolve, reject) => {
      victim.once('open', () => resolve());
      victim.once('error', reject);
    });

    // Every one of these is a request line the HTTP parser hands straight to
    // the 'upgrade' listener and a request-target `new URL()` rejects.
    for (const target of ['//[::1', 'http://[', '//user@[v1.x]', '//:']) {
      expect(await rawUpgrade(h, target)).toContain('400 Bad Request');
    }

    expect(victim.readyState).toBe(WebSocket.OPEN);
    expect(h.connections.get(client.peerId)).toBeDefined();
    // Still serving: the process, the HTTP surface and the upgrade path all
    // outlived the malformed requests.
    expect((await fetch(`${h.baseUrl}${DESCRIPTOR_PATH}`)).status).toBe(200);
    expect(
      await upgrades(wsUrlFor(h, client, await ticketFor(h, client)))
    ).toBe(true);
    victim.close();
  });

  it('D3 audit: a raw upgrade socket that errors after a rejection does not crash the node', async () => {
    const h = await startHost();
    const fakeSocket = new EventEmitter();
    Object.assign(fakeSocket, { write: () => true, destroy: () => undefined });
    const req = { url: '/ws?ticket=not-a-real-ticket' } as IncomingMessage;

    const withPrivateAccess = h as unknown as {
      handleUpgrade(req: IncomingMessage, socket: Socket, head: Buffer): void;
    };
    // The bad ticket takes the write-401-then-destroy rejection path.
    expect(() =>
      withPrivateAccess.handleUpgrade(
        req,
        fakeSocket as unknown as Socket,
        Buffer.alloc(0)
      )
    ).not.toThrow();
    // A client resetting the connection right as we reject it must not
    // surface as an unhandled 'error' — same class of bug as D3's stdin
    // write, and an EventEmitter with nobody listening throws synchronously
    // when one fires.
    expect(() =>
      fakeSocket.emit('error', new Error('ECONNRESET'))
    ).not.toThrow();
  });
});
