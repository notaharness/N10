import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MutualAuth,
  signNonce,
  verifyHostSignature,
  verifySignature,
} from './auth.js';
import type { AuthError } from './auth.js';
import {
  hostTranscript,
  sessionTranscript,
  type HandshakeParties,
} from './handshake-transcript.js';
import { derivePeerId } from './identity.js';
import { PeerTable } from './peer-table.js';

/** Run `fn`, returning the error it threw. Keeps `.kind` assertions out of
 * the `catch` block, which vitest's no-conditional-expect rule flags. */
function captureError(fn: () => unknown): AuthError {
  try {
    fn();
  } catch (error) {
    return error as AuthError;
  }
  throw new Error('expected fn to throw');
}

function keyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKeyPem: privateKey
      .export({ type: 'pkcs8', format: 'pem' })
      .toString(),
  };
}

describe('signNonce / verifySignature', () => {
  it('a signature made with the matching private key verifies', () => {
    const { publicKeyPem, privateKeyPem } = keyPair();
    const signature = signNonce(privateKeyPem, 'nonce-1');
    expect(verifySignature(publicKeyPem, 'nonce-1', signature)).toBe(true);
  });

  it('a signature does not verify against a different nonce', () => {
    const { publicKeyPem, privateKeyPem } = keyPair();
    const signature = signNonce(privateKeyPem, 'nonce-1');
    expect(verifySignature(publicKeyPem, 'nonce-2', signature)).toBe(false);
  });

  it('a signature does not verify against a different key', () => {
    const a = keyPair();
    const b = keyPair();
    const signature = signNonce(a.privateKeyPem, 'nonce-1');
    expect(verifySignature(b.publicKeyPem, 'nonce-1', signature)).toBe(false);
  });

  it('malformed base64 fails closed rather than throwing', () => {
    const { publicKeyPem } = keyPair();
    expect(
      verifySignature(
        publicKeyPem,
        'nonce',
        'not valid base64 signature bytes!!'
      )
    ).toBe(false);
  });
});

describe('MutualAuth', () => {
  let dir: string;
  let peers: PeerTable;
  let host: ReturnType<typeof keyPair>;
  let hostPeerId: string;
  let client: ReturnType<typeof keyPair>;
  let clientPeerId: string;
  let parties: HandshakeParties;
  let auth: MutualAuth;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'beam-auth-'));
    peers = new PeerTable(dir);
    host = keyPair();
    hostPeerId = derivePeerId(host.publicKeyPem);
    client = keyPair();
    clientPeerId = derivePeerId(client.publicKeyPem);
    parties = { hostPeerId, clientPeerId };
    peers.upsert({
      peerId: clientPeerId,
      label: 'client',
      publicKeyPem: client.publicKeyPem,
      endpoints: [],
    });
    auth = new MutualAuth({
      peers,
      hostPeerId,
      privateKeyPem: host.privateKeyPem,
    });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** What an honest client signs: the challenge inside a transcript naming
   * this host and itself. */
  const clientProof = (challenge: string, over = parties) =>
    signNonce(client.privateKeyPem, sessionTranscript(over, challenge));

  function proveWith(
    overrides: { peerId?: string; challenge?: string; signature?: string } = {}
  ) {
    const challenge =
      overrides.challenge ?? auth.issueChallenge(clientPeerId);
    const signature = overrides.signature ?? clientProof(challenge);
    return auth.proveSession({
      peerId: overrides.peerId ?? clientPeerId,
      challenge,
      signature,
      clientChallenge: 'client-nonce',
    });
  }

  it('a valid signature authenticates and returns a ticket plus a host signature', () => {
    const result = proveWith();
    expect(typeof result.ticket).toBe('string');
    expect(
      verifySignature(
        host.publicKeyPem,
        hostTranscript(parties, 'client-nonce'),
        result.hostSignature
      )
    ).toBe(true);
    // ...and over nothing else: a bare `clientChallenge` signature is the
    // oracle the transcript exists to close.
    expect(
      verifySignature(host.publicKeyPem, 'client-nonce', result.hostSignature)
    ).toBe(false);
  });

  it('rejects an unknown peer', () => {
    const error = captureError(() => proveWith({ peerId: 'not-a-real-peer' }));
    expect(error.kind).toBe('unknown-peer');
  });

  it('rejects a revoked peer', () => {
    peers.revoke(clientPeerId);
    const error = captureError(() => proveWith());
    expect(error.kind).toBe('revoked-peer');
  });

  it('rejects a tampered signature, and the legitimate challenge still works afterward', () => {
    const challenge = auth.issueChallenge(clientPeerId);
    const tampered = clientProof('a-different-nonce');
    const error = captureError(() =>
      proveWith({ challenge, signature: tampered })
    );
    expect(error.kind).toBe('bad-signature');
    // The bogus signature must not have burned the legitimate challenge.
    const good = clientProof(challenge);
    const result = auth.proveSession({
      peerId: clientPeerId,
      challenge,
      signature: good,
      clientChallenge: 'x',
    });
    expect(typeof result.ticket).toBe('string');
  });

  it('rejects a challenge the host never issued', () => {
    const forged = 'never-issued-challenge';
    const signature = clientProof(forged);
    const error = captureError(() =>
      proveWith({ challenge: forged, signature })
    );
    expect(error.kind).toBe('stale-challenge');
  });

  it('rejects a stale (expired) challenge', () => {
    let now = 0;
    const timedAuth = new MutualAuth({
      peers,
      hostPeerId,
      privateKeyPem: host.privateKeyPem,
      now: () => now,
      challengeTtlMs: 100,
    });
    const challenge = timedAuth.issueChallenge(clientPeerId);
    now = 200;
    const signature = clientProof(challenge);
    const error = captureError(() =>
      timedAuth.proveSession({
        peerId: clientPeerId,
        challenge,
        signature,
        clientChallenge: 'x',
      })
    );
    expect(error.kind).toBe('stale-challenge');
  });

  it('refuses a challenge minted for another peer, without spending it', () => {
    const other = keyPair();
    const otherPeerId = derivePeerId(other.publicKeyPem);
    peers.upsert({
      peerId: otherPeerId,
      label: 'other',
      publicKeyPem: other.publicKeyPem,
      endpoints: [],
    });
    // A nonce `/challenge/:peerId` minted for `other`, presented by the
    // client with a signature that is otherwise perfectly valid.
    const mintedForOther = auth.issueChallenge(otherPeerId);
    const error = captureError(() =>
      proveWith({ challenge: mintedForOther })
    );
    expect(error.kind).toBe('stale-challenge');
    // Refused without being spent: `other` can still use its own nonce,
    // so presenting it elsewhere is not a way to burn it.
    const result = auth.proveSession({
      peerId: otherPeerId,
      challenge: mintedForOther,
      signature: signNonce(
        other.privateKeyPem,
        sessionTranscript(
          { hostPeerId, clientPeerId: otherPeerId },
          mintedForOther
        )
      ),
      clientChallenge: 'x',
    });
    expect(typeof result.ticket).toBe('string');
  });

  it('refuses a signature bound to a different host', () => {
    const elsewhere = derivePeerId(keyPair().publicKeyPem);
    const challenge = auth.issueChallenge(clientPeerId);
    const error = captureError(() =>
      proveWith({
        challenge,
        signature: clientProof(challenge, {
          hostPeerId: elsewhere,
          clientPeerId,
        }),
      })
    );
    expect(error.kind).toBe('bad-signature');
  });

  it('refuses a bare signature over the challenge with no transcript', () => {
    const challenge = auth.issueChallenge(clientPeerId);
    const error = captureError(() =>
      proveWith({
        challenge,
        signature: signNonce(client.privateKeyPem, challenge),
      })
    );
    expect(error.kind).toBe('bad-signature');
  });

  it('a ticket is single-use', () => {
    const { ticket } = proveWith();
    expect(auth.consumeTicket(ticket)).toBe(clientPeerId);
    const error = captureError(() => auth.consumeTicket(ticket));
    expect(error.kind).toBe('spent-ticket');
  });
});

describe('verifyHostSignature (client side)', () => {
  const parties: HandshakeParties = {
    hostPeerId: '0123456789abcdef',
    clientPeerId: 'fedcba9876543210',
  };

  it('accepts a signature that verifies against the stored host key', () => {
    const host = keyPair();
    const signature = signNonce(
      host.privateKeyPem,
      hostTranscript(parties, 'nonce')
    );
    expect(() =>
      verifyHostSignature(host.publicKeyPem, parties, 'nonce', signature)
    ).not.toThrow();
  });

  it('rejects a host whose returned signature does not verify against the stored key', () => {
    const host = keyPair();
    const impostor = keyPair();
    const signature = signNonce(
      impostor.privateKeyPem,
      hostTranscript(parties, 'nonce')
    );
    const error = captureError(() =>
      verifyHostSignature(host.publicKeyPem, parties, 'nonce', signature)
    );
    expect(error.kind).toBe('host-key-mismatch');
  });

  it('rejects the right key signing the nonce for a different pair', () => {
    const host = keyPair();
    const signature = signNonce(
      host.privateKeyPem,
      hostTranscript(
        { hostPeerId: parties.hostPeerId, clientPeerId: '00000000000000ff' },
        'nonce'
      )
    );
    const error = captureError(() =>
      verifyHostSignature(host.publicKeyPem, parties, 'nonce', signature)
    );
    expect(error.kind).toBe('host-key-mismatch');
  });
});
