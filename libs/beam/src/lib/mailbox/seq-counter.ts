/**
 * The mailbox's monotonic send counter (`mailbox/seq.json`): one counter per
 * recipient peer, since the receiver's dedup (SeenTracker) tracks the
 * highest seq accepted *from* a given sender — that only lines up if each
 * sender assigns a strictly increasing sequence per recipient, not one
 * shared across every peer it talks to. See docs/beam.md.
 *
 * D2: a counter that cannot be trusted must not be guessed. An unreadable or
 * unparseable file throws (below), exactly as SeenTracker does, rather than
 * silently restarting numbering at 1 — with contiguity gone (D1) the
 * receiver's dedup can no longer tell a reset apart from a legitimate resend
 * once the counter climbs back past what it already accepted, which is
 * exactly the "reported delivered but never arrived" bug this replaces: a
 * reset counter reissues a seq the receiver already saw, the receiver acks
 * it as the duplicate it looks like, and the sender unlinks a file for a
 * message nobody ever got. On top of that, `next()` also reconciles against
 * this peer's own on-disk queue (its live backlog and anything already
 * quarantined) so a *lost* (not merely corrupt) counter file — genuinely
 * indistinguishable on disk from a fresh one — still cannot reissue a seq
 * this node already assigned and wrote down, as long as some trace of it
 * survives on disk. A seq already delivered and unlinked before the loss
 * leaves no such trace; that narrower residual window is not closable from
 * local state alone.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { assertPeerId } from '../identifiers.js';
import { MailboxCorruptionError } from './seen-tracker.js';

/** Reused across every peer's counter: `seq.json` holds one shared object,
 * so a single corrupt or unreadable file affects every peer at once, not
 * just one — there is no single peerId to attribute it to. */
const SEQ_COUNTER_SCOPE = '<seq-counter>';

export class SeqCounter {
  private readonly dir: string;
  private readonly outDir: string;
  private readonly path: string;
  private counts: Record<string, number>;

  constructor(beamDir: string) {
    this.dir = join(beamDir, 'mailbox');
    this.outDir = join(this.dir, 'out');
    this.path = join(this.dir, 'seq.json');
    this.counts = this.load();
  }

  /** The next sequence number to assign for `peerId`, starting at 1.
   * Synchronous end to end (no `await` between read, increment and
   * persist), so two sends issued back to back — even from concurrent
   * in-flight async callers — can never be handed the same value: Node
   * cannot interleave two synchronous calls. Reconciled against this
   * peer's own on-disk queue on every call (D2) — see the class comment. */
  next(peerId: string): number {
    const seq = this.reserve(peerId);
    this.commit(peerId, seq);
    return seq;
  }

  /** The seq `next()` would hand out, without recording the claim. Pure:
   * nothing in memory or on disk moves. Split from `commit` so a caller
   * that has to write the message itself can persist the claim only once
   * the message is durably stored — a number claimed for a message that
   * then failed to store is a permanent gap in that peer's sequence. */
  reserve(peerId: string): number {
    return (
      Math.max(this.counts[peerId] ?? 0, this.highestQueuedSeq(peerId)) + 1
    );
  }

  /** Record a reserved seq as spent. Callers keep the whole
   * reserve-store-commit sequence synchronous, so two sends issued back to
   * back cannot interleave and be handed the same value. */
  commit(peerId: string, seq: number): void {
    this.counts = { ...this.counts, [peerId]: seq };
    this.save();
  }

  /** The highest seq already written to disk for `peerId` — in its live
   * queue or already quarantined — so a persisted counter that is behind
   * its own queue (itself a form of corruption) can never hand out a seq
   * this node has already assigned. */
  private highestQueuedSeq(peerId: string): number {
    // The id is joined into a path here too, so it meets the same boundary
    // check as the queue's own paths (identifiers.ts).
    assertPeerId(peerId);
    let max = 0;
    for (const sub of ['', 'corrupt']) {
      const dir = sub
        ? join(this.outDir, peerId, sub)
        : join(this.outDir, peerId);
      let names: string[];
      try {
        names = readdirSync(dir);
      } catch {
        continue;
      }
      for (const name of names) {
        const match = /^(\d+)\.json$/.exec(name);
        if (match) max = Math.max(max, Number(match[1]));
      }
    }
    return max;
  }

  private load(): Record<string, number> {
    if (!existsSync(this.path)) return {};
    let raw: string;
    try {
      raw = readFileSync(this.path, 'utf8');
    } catch (error) {
      throw new MailboxCorruptionError(
        SEQ_COUNTER_SCOPE,
        `seq counter is unreadable: ${(error as Error).message}`
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new MailboxCorruptionError(
        SEQ_COUNTER_SCOPE,
        `seq counter is malformed: ${(error as Error).message}`
      );
    }
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      throw new MailboxCorruptionError(
        SEQ_COUNTER_SCOPE,
        'seq counter is malformed'
      );
    }
    return parsed as Record<string, number>;
  }

  private save(): void {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.counts), { mode: 0o600 });
    renameSync(tmp, this.path);
  }
}
