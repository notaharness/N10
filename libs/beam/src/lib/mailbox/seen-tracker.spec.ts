import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/** Real-shaped peer ids: 16 lowercase hex characters, as `derivePeerId`
 * produces and as the store's path boundary requires (identifiers.ts). */
const PEER = '00000000000000aa';
const PEER_A = '00000000000000a1';
const PEER_B = '00000000000000b2';
import { MailboxCorruptionError, SeenTracker } from './seen-tracker.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'beam-seen-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('SeenTracker', () => {
  it('accepts seq 1 first, then rejects a repeat as duplicate', () => {
    const tracker = new SeenTracker(dir);
    expect(tracker.accept(PEER, 1)).toBe('accepted');
    expect(tracker.accept(PEER, 1)).toBe('duplicate');
  });

  it('accepts a jump ahead — there is no contiguity requirement (D1)', () => {
    const tracker = new SeenTracker(dir);
    expect(tracker.accept(PEER, 1)).toBe('accepted');
    expect(tracker.accept(PEER, 2)).toBe('accepted');
    expect(tracker.accept(PEER, 5)).toBe('accepted');
    expect(tracker.lastSeq(PEER)).toBe(5);
    // Anything at or below the new lastSeq is now a duplicate, including
    // the seqs the jump skipped over — there is no hole left to fill.
    expect(tracker.accept(PEER, 3)).toBe('duplicate');
    expect(tracker.accept(PEER, 5)).toBe('duplicate');
  });

  it('treats anything at or below last as duplicate, never as a gap', () => {
    const tracker = new SeenTracker(dir);
    tracker.accept(PEER, 1);
    tracker.accept(PEER, 2);
    tracker.accept(PEER, 3);
    expect(tracker.accept(PEER, 1)).toBe('duplicate');
    expect(tracker.accept(PEER, 2)).toBe('duplicate');
  });

  it('tracks each sender independently', () => {
    const tracker = new SeenTracker(dir);
    expect(tracker.accept(PEER_A, 1)).toBe('accepted');
    expect(tracker.accept(PEER_B, 1)).toBe('accepted');
    expect(tracker.accept(PEER_A, 2)).toBe('accepted');
    expect(tracker.lastSeq(PEER_B)).toBe(1);
  });

  it('persists across instances against the same beamDir', () => {
    new SeenTracker(dir).accept(PEER, 1);
    const reopened = new SeenTracker(dir);
    expect(reopened.lastSeq(PEER)).toBe(1);
    expect(reopened.accept(PEER, 1)).toBe('duplicate');
  });

  it('a partially/unparseable seen file throws MailboxCorruptionError rather than resetting to 0', () => {
    const seenDir = join(dir, 'mailbox', 'seen');
    mkdirSync(seenDir, { recursive: true });
    writeFileSync(join(seenDir, `${PEER}.json`), '{"lastSeq": tr'); // torn/garbage write
    const tracker = new SeenTracker(dir);
    expect(() => tracker.lastSeq(PEER)).toThrow(MailboxCorruptionError);
    expect(() => tracker.accept(PEER, 1)).toThrow(MailboxCorruptionError);
  });

  it('a seen file missing the lastSeq field is also corruption, not silently 0', () => {
    const seenDir = join(dir, 'mailbox', 'seen');
    mkdirSync(seenDir, { recursive: true });
    writeFileSync(
      join(seenDir, `${PEER}.json`),
      JSON.stringify({ oops: true })
    );
    const tracker = new SeenTracker(dir);
    expect(() => tracker.lastSeq(PEER)).toThrow(MailboxCorruptionError);
  });
});
