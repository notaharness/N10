/**
 * beam mutual authentication — every later connection is proved by a fresh
 * challenge nonce signed by the peer's Ed25519 key. The host verifies the
 * peer's signature *before* consuming the challenge, so a bogus signature
 * cannot burn the legitimate one; it then signs the client's own nonce so
 * the client can verify it is talking to the peer whose key it stored.
 *
 * Nothing here signs a bare value. Every signature covers a transcript
 * naming the context and both machines (`handshake-transcript.ts`), and
 * every challenge is minted for one named peer, so a proof cannot be
 * moved between hosts, between peers, or between the `/session` and `/ws`
 * exchanges. See docs/beam.md.
 */

import { sign as cryptoSign, verify as cryptoVerify } from 'node:crypto';
import {
  hostTranscript,
  sessionTranscript,
  type HandshakeParties,
} from './handshake-transcript.js';
import type { PeerTable } from './peer-table.js';
import {
  CHALLENGE_TTL_MS,
  SingleUseSecrets,
  TICKET_TTL_MS,
} from './secrets.js';

export type AuthErrorKind =
  | 'unknown-peer'
  | 'revoked-peer'
  | 'bad-signature'
  | 'stale-challenge'
  | 'spent-ticket'
  | 'host-key-mismatch'
  | 'host-id-mismatch';

export class AuthError extends Error {
  constructor(public readonly kind: AuthErrorKind, message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

/** Sign `nonce` with this machine's private key; the base64 answer proves
 * possession of the key without ever exposing it. The callers in the
 * handshake always pass a transcript, never a value the far side chose. */
export function signNonce(privateKeyPem: string, nonce: string): string {
  return cryptoSign(null, Buffer.from(nonce, 'utf8'), privateKeyPem).toString(
    'base64'
  );
}

/** Verify a nonce signature against a public key. Fails closed: malformed
 * base64 or an unusable key is a verification failure, never a throw. */
export function verifySignature(
  publicKeyPem: string,
  nonce: string,
  signatureB64: string
): boolean {
  try {
    const signature = Buffer.from(signatureB64, 'base64');
    return cryptoVerify(
      null,
      Buffer.from(nonce, 'utf8'),
      publicKeyPem,
      signature
    );
  } catch {
    return false;
  }
}

/** Client side of the handshake: verify the host's proof against the public
 * key already stored for it, and abort on mismatch. The transcript is built
 * here rather than taken from the caller, so a caller cannot accidentally
 * accept a signature over an unbound value. */
export function verifyHostSignature(
  hostPublicKeyPem: string,
  parties: HandshakeParties,
  clientChallenge: string,
  hostSignature: string
): void {
  const expected = hostTranscript(parties, clientChallenge);
  if (!verifySignature(hostPublicKeyPem, expected, hostSignature)) {
    throw new AuthError(
      'host-key-mismatch',
      "the host's signature does not verify against its stored public key"
    );
  }
}

export interface SessionProof {
  peerId: string;
  challenge: string;
  signature: string;
  clientChallenge: string;
}

export interface SessionResult {
  ticket: string;
  hostSignature: string;
}

export interface MutualAuthOptions {
  peers: PeerTable;
  /** This machine's own id, which every transcript it signs or verifies
   * names as the host side. */
  hostPeerId: string;
  /** This machine's own private key, used to sign the client's nonce. */
  privateKeyPem: string;
  now?: () => number;
  challengeTtlMs?: number;
  ticketTtlMs?: number;
}

/** Owns this machine's challenge and ticket pools and drives the mutual
 * proof described in docs/beam.md's HTTP surface (`/challenge`, `/session`). */
export class MutualAuth {
  private readonly peers: PeerTable;
  private readonly hostPeerId: string;
  private readonly privateKeyPem: string;
  /** A challenge carries the peerId it was minted for: `/challenge/:peerId`
   * names a peer, so a nonce handed to one peer must not be spendable by
   * another. Without the payload the pool is fungible, and any peer that
   * may ask this host for a nonce can fetch one in a third party's name. */
  private readonly challenges: SingleUseSecrets<string>;
  private readonly tickets: SingleUseSecrets<string>;

  constructor(options: MutualAuthOptions) {
    this.peers = options.peers;
    this.hostPeerId = options.hostPeerId;
    this.privateKeyPem = options.privateKeyPem;
    const now = options.now ?? Date.now;
    this.challenges = new SingleUseSecrets(
      options.challengeTtlMs ?? CHALLENGE_TTL_MS,
      now
    );
    this.tickets = new SingleUseSecrets(
      options.ticketTtlMs ?? TICKET_TTL_MS,
      now
    );
  }

  /** Mint a nonce for `peerId` to sign (60s TTL by default). Bound to that
   * peer: `proveSession` refuses it from anyone else. */
  issueChallenge(peerId: string): string {
    return this.challenges.issue(peerId);
  }

  /**
   * Verify the peer's signature *before* consuming the challenge, then
   * sign the client's own nonce and issue a single-use ticket. Both
   * signatures are over transcripts naming this host and that peer, so
   * neither is worth anything to a third machine. Throws AuthError with a
   * specific, UI-facing kind.
   */
  proveSession(proof: SessionProof): SessionResult {
    const peer = this.peers.get(proof.peerId);
    if (!peer)
      throw new AuthError('unknown-peer', `no such peer: ${proof.peerId}`);
    if (peer.revoked)
      throw new AuthError(
        'revoked-peer',
        `peer ${proof.peerId} has been revoked`
      );
    // The stored record's id, never the caller's spelling of it: the
    // transcript is what binds this proof to a peer, so it must be built
    // from what this machine believes, not from the request body.
    const parties: HandshakeParties = {
      hostPeerId: this.hostPeerId,
      clientPeerId: peer.peerId,
    };
    const expected = sessionTranscript(parties, proof.challenge);
    if (!verifySignature(peer.publicKeyPem, expected, proof.signature)) {
      throw new AuthError(
        'bad-signature',
        'signature does not verify against the stored public key'
      );
    }
    this.spendChallenge(proof.challenge, peer.peerId);
    const ticket = this.tickets.issue(peer.peerId);
    return {
      ticket,
      hostSignature: signNonce(
        this.privateKeyPem,
        hostTranscript(parties, proof.clientChallenge)
      ),
    };
  }

  /** Consume a challenge, but only if it was minted for `peerId`. The
   * binding is checked against a peek so that a nonce minted for someone
   * else is refused without being spent — a peer that fetched a nonce in a
   * third party's name would otherwise get to burn it. */
  private spendChallenge(challenge: string, peerId: string): void {
    const stale = (): never => {
      throw new AuthError(
        'stale-challenge',
        'challenge was not issued by this host for this peer, or has expired'
      );
    };
    const peeked = this.challenges.peek(challenge);
    if (!peeked.valid || peeked.payload !== peerId) stale();
    if (!this.challenges.consume(challenge).valid) stale();
  }

  /**
   * The peerId a ticket was issued for, without spending it; null if the
   * ticket is unknown, expired or already used.
   *
   * The WS upgrade verifies the caller's proof *before* consuming the
   * ticket, so a bogus proof cannot burn the legitimate client's — the
   * same rule `proveSession` applies to the challenge. The peerId has to
   * come from the ticket rather than from the caller, or an attacker
   * would get to choose which key their own proof is checked against.
   */
  peekTicket(ticket: string): string | null {
    const result = this.tickets.peek(ticket);
    return result.valid ? result.payload : null;
  }

  /** Consume a ticket, returning the peerId it was issued for. */
  consumeTicket(ticket: string): string {
    const result = this.tickets.consume(ticket);
    if (!result.valid)
      throw new AuthError(
        'spent-ticket',
        'ticket is invalid, expired, or already used'
      );
    return result.payload;
  }
}
