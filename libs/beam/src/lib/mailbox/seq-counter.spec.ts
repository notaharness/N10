import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MailboxCorruptionError } from './seen-tracker.js';
import { SeqCounter } from './seq-counter.js';

/** Real-shaped peer ids: 16 lowercase hex characters, as `derivePeerId`
 * produces and as the counter's own path boundary requires
 * (identifiers.ts). */
const PEER_X = '00000000000000ec';
const PEER_Y = '00000000000000ed';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'beam-seqc-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('SeqCounter', () => {
  it('starts each peer at 1 and increments per call', () => {
    const counter = new SeqCounter(dir);
    expect(counter.next(PEER_X)).toBe(1);
    expect(counter.next(PEER_X)).toBe(2);
    expect(counter.next(PEER_X)).toBe(3);
  });

  it('tracks each peer independently', () => {
    const counter = new SeqCounter(dir);
    expect(counter.next(PEER_X)).toBe(1);
    expect(counter.next(PEER_Y)).toBe(1);
    expect(counter.next(PEER_X)).toBe(2);
  });

  it('back-to-back calls (simulating concurrent async callers) never repeat a value', () => {
    const counter = new SeqCounter(dir);
    // Two "concurrent" callers in real code both call next() without an
    // await between the call and the read — this loop is that shape.
    const seqs = Array.from({ length: 20 }, () => counter.next(PEER_X));
    expect(new Set(seqs).size).toBe(20);
    expect(seqs).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it('persists across instances against the same beamDir', () => {
    new SeqCounter(dir).next(PEER_X);
    const reopened = new SeqCounter(dir);
    expect(reopened.next(PEER_X)).toBe(2);
  });

  it('a malformed counter file throws rather than silently resetting to 1 (D2)', () => {
    const path = join(dir, 'mailbox', 'seq.json');
    new SeqCounter(dir).next(PEER_X); // creates the real file (mailbox/ dir included) first.
    writeFileSync(path, 'not valid json {{');
    // A counter that cannot be trusted must not be guessed: resetting to 1
    // would reissue a seq the receiver already accepted, which it would
    // then judge a duplicate, ack, and let the sender unlink — a real
    // message silently lost and reported delivered.
    expect(() => new SeqCounter(dir)).toThrow(MailboxCorruptionError);
  });

  it('a seq.json that cannot be read as a file also throws, not resets', () => {
    const path = join(dir, 'mailbox', 'seq.json');
    // A directory where the file should be makes readFileSync fail (EISDIR)
    // — a different failure shape than a parse error, and it must be
    // treated the same way: loud, not guessed.
    mkdirSync(path, { recursive: true });
    expect(() => new SeqCounter(dir)).toThrow(MailboxCorruptionError);
  });

  it('reconciles against the highest seq already in the queue directory when the counter file is missing (D2)', () => {
    const outDir = join(dir, 'mailbox', 'out', PEER_X);
    mkdirSync(outDir, { recursive: true });
    // A real queued file survives even though seq.json itself is gone —
    // e.g. it was never written yet, or was lost outright.
    writeFileSync(join(outDir, '0000000005.json'), '{}');
    const counter = new SeqCounter(dir);
    expect(counter.next(PEER_X)).toBe(6);
  });

  it('reconciliation also counts quarantined files, so a lost seq is never reissued (D2)', () => {
    const corruptDir = join(dir, 'mailbox', 'out', PEER_X, 'corrupt');
    mkdirSync(corruptDir, { recursive: true });
    writeFileSync(join(corruptDir, '0000000009.json'), 'garbage');
    const counter = new SeqCounter(dir);
    expect(counter.next(PEER_X)).toBe(10);
  });

  it('reconciliation never lowers the counter when the persisted value is already ahead of the queue', () => {
    const outDir = join(dir, 'mailbox', 'out', PEER_X);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, '0000000002.json'), '{}');
    new SeqCounter(dir).next(PEER_X); // persists 3 (max(0, 2) + 1).
    const reopened = new SeqCounter(dir);
    expect(reopened.next(PEER_X)).toBe(4); // not max(0, 2) + 1 again.
  });
});

/**
 * The corruption *shapes* `seq.json` can actually take on a real disk, not
 * just the hand-written one above. `save()` is write-temp-then-rename with
 * no `fsync` on either the file or the directory, so a power loss can leave
 * the rename durable while the data behind it is not — and the file the
 * reader then finds is empty, or truncated, or full of zero bytes. Every
 * one of them has to reach the same refusal (D2): a counter that restarts
 * reissues numbers the receiver already accepted, and the sender then
 * reports `delivered` for mail nobody will ever get.
 */
describe('SeqCounter: the corruption shapes a crash can leave behind', () => {
  /** Put exactly `contents` where `seq.json` lives and hand back the read
   * that has to refuse it. Writes the file directly rather than through a
   * SeqCounter, so a case that leaves the file corrupt cannot make the
   * *next* case fail in its setup instead of its assertion. */
  function withFile(contents: string | Buffer): () => SeqCounter {
    mkdirSync(join(dir, 'mailbox'), { recursive: true });
    writeFileSync(join(dir, 'mailbox', 'seq.json'), contents);
    return () => new SeqCounter(dir);
  }

  it('an empty file — the one a crash between rename and flush leaves — throws', () => {
    expect(withFile('')).toThrow(MailboxCorruptionError);
  });

  it('a file of NUL bytes, the other common torn-write remnant, throws', () => {
    expect(withFile(Buffer.alloc(64))).toThrow(MailboxCorruptionError);
  });

  it('a truncated but still JSON-looking file throws', () => {
    expect(withFile('{"00000000000000c0":')).toThrow(MailboxCorruptionError);
  });

  it('valid JSON of the wrong shape — an array, a string, null — throws rather than being read as a counter map', () => {
    for (const contents of ['[]', '"1"', 'null', '7']) {
      expect(withFile(contents)).toThrow(MailboxCorruptionError);
    }
  });

  it('the positive control: a well-formed counter file is read, not refused', () => {
    // Without this, every assertion above would also pass against a
    // constructor that threw unconditionally.
    const read = withFile(JSON.stringify({ [PEER_X]: 41 }));
    expect(read().next(PEER_X)).toBe(42);
  });
});
