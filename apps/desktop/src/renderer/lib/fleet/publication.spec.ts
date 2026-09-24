import { describe, expect, it } from 'vitest';
import type { CeremonyOutcome } from '../../../host/contract-machines.js';
import { landedKey, pendingAfter, publicationKey } from './publication.js';

type Succeeded = Extract<CeremonyOutcome, { ok: true }>;

const SELF = 'a'.repeat(32);
const OTHER = 'b'.repeat(32);

const joined = (published: boolean): Succeeded => ({
  ok: true,
  op: 'join',
  peerId: SELF,
  fleetId: 'f'.repeat(64),
  members: 2,
  published,
});
const revoked = (published: boolean): Succeeded => ({
  ok: true,
  op: 'revoke',
  peerId: OTHER,
  published,
  acknowledgedBy: 0,
});
const refused: CeremonyOutcome = { ok: false, code: 'busy', detail: null };

describe('publicationKey', () => {
  it('is the key of the event that settles that write, and no other', () => {
    expect(landedKey({ kind: 'member', peerId: SELF })).toBe(
      publicationKey(joined(false))
    );
    expect(landedKey({ kind: 'revoke', peerId: OTHER })).toBe(
      publicationKey(revoked(false))
    );
    expect(landedKey({ kind: 'revoke', peerId: SELF })).not.toBe(
      publicationKey(joined(false))
    );
    expect(landedKey({ kind: 'member', peerId: OTHER })).not.toBe(
      publicationKey(joined(false))
    );
  });

  it('matches the directory.published event each write settles on', () => {
    expect(publicationKey(joined(false))).toBe(`member/${SELF}`);
    expect(
      publicationKey({
        ok: true,
        op: 'init',
        peerId: SELF,
        fleetId: 'f'.repeat(64),
        published: false,
      })
    ).toBe(`member/${SELF}`);
    expect(publicationKey(revoked(false))).toBe(`revoke/${OTHER}`);
  });
});

describe('pendingAfter', () => {
  const none: ReadonlySet<string> = new Set();

  it('adds a success’s write while it is pending', () => {
    expect(pendingAfter(none, joined(false))).toEqual(
      new Set([`member/${SELF}`])
    );
    expect(pendingAfter(new Set([`member/${SELF}`]), revoked(false))).toEqual(
      new Set([`member/${SELF}`, `revoke/${OTHER}`])
    );
  });

  it('keeps earlier writes through a published, failed or cancelled ceremony', () => {
    const earlier = new Set([`member/${SELF}`]);
    expect(pendingAfter(earlier, revoked(true))).toBe(earlier);
    expect(pendingAfter(earlier, refused)).toBe(earlier);
  });
});
