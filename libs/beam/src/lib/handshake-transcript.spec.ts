/**
 * The encoding itself, separately from the exchanges that use it.
 *
 * Two of the three bindings are provable end to end: `relay-impersonation`
 * shows what the `/session` and `/host` transcripts refuse. The third —
 * the parties inside the `/ws` proof — is not, because a ticket is only
 * ever valid at the host that minted it and names its peer by itself, so
 * no reachable attack distinguishes `beam-ws:<ticket>` from the bound
 * form. It is here for uniformity: "every beam signature names its
 * context and both machines" is an invariant a reader can check at a
 * glance, where "two of the three do" is the shape this bug had in the
 * first place. That makes the encoding its own contract, and this is
 * where it is held to it.
 */

import { describe, expect, it } from 'vitest';
import {
  hostTranscript,
  sessionTranscript,
  wsTranscript,
  type HandshakeParties,
} from './handshake-transcript.js';

const parties: HandshakeParties = {
  hostPeerId: '0123456789abcdef',
  clientPeerId: 'fedcba9876543210',
};

const builders = [sessionTranscript, hostTranscript, wsTranscript];

describe('handshake transcripts', () => {
  it('gives the three contexts three different strings for one payload', () => {
    const built = builders.map((build) => build(parties, 'payload'));
    expect(new Set(built).size).toBe(builders.length);
  });

  it('names the host, so one host’s proof is not another’s', () => {
    for (const build of builders) {
      expect(build(parties, 'payload')).not.toBe(
        build({ ...parties, hostPeerId: 'ffffffffffffffff' }, 'payload')
      );
    }
  });

  it('names the client, so one peer’s proof is not another’s', () => {
    for (const build of builders) {
      expect(build(parties, 'payload')).not.toBe(
        build({ ...parties, clientPeerId: 'ffffffffffffffff' }, 'payload')
      );
    }
  });

  it('puts the payload last, where nothing follows it to be confused with', () => {
    expect(sessionTranscript(parties, 'a:b:c')).toBe(
      `beam-session:${parties.hostPeerId}:${parties.clientPeerId}:a:b:c`
    );
  });

  it('refuses an id that is not a peerId rather than joining it', () => {
    // The `:` join is unambiguous because the two variable-position fields
    // are fixed-width hex. `PeerTable.load` does not re-validate what it
    // reads back from disk, so this assertion is what keeps that true: a
    // record carrying a separator throws instead of producing a transcript
    // that parses two ways.
    const injected = 'dead:beefdeadbe';
    expect(() =>
      sessionTranscript({ ...parties, clientPeerId: injected }, 'x')
    ).toThrow(/clientPeerId must be 16 lowercase hex/);
    expect(() =>
      sessionTranscript({ ...parties, hostPeerId: injected }, 'x')
    ).toThrow(/hostPeerId must be 16 lowercase hex/);
  });

  it('refuses an id of the wrong length, which would shift every field', () => {
    expect(() =>
      wsTranscript({ ...parties, hostPeerId: '0123456789abcde' }, 'x')
    ).toThrow(/16 lowercase hex/);
  });
});
