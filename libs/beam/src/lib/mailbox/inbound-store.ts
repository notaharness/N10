/**
 * The durable per-sender inbound store: `mailbox/in/<peerId>/`, one file per
 * envelope accepted from that sender and not yet taken by a subscriber,
 * written temp-then-rename and named by zero-padded seq — the same shape as
 * `OutboundQueue`, reused rather than reinvented (D15, docs/beam.md).
 *
 * Unlike the outbound queue, a filename collision here is not a bug: it is
 * the ordinary shape of a resend the sender makes because it never saw our
 * wire ack (see Mailbox.handleEnvelopeFrame), so `enqueue` treats an
 * existing file at the same seq as already-durable rather than refusing it.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { assertPeerId } from '../identifiers.js';
import { isEnvelope, type Envelope } from './envelope.js';
import {
  isAtLimit,
  resolveQueueLimits,
  type QueueLimits,
} from './queue-limits.js';

const SEQ_PAD = 10;

export class InboundStore {
  private readonly root: string;
  private readonly limits: QueueLimits;

  constructor(beamDir: string, limits: Partial<QueueLimits> = {}) {
    this.root = join(beamDir, 'mailbox', 'in');
    this.limits = resolveQueueLimits(limits);
    this.reapStaleTemp();
  }

  /** Whether this sender's backlog is at either bound. A subscriber that
   * never attaches, or never acks, must not let one peer fill the disk:
   * an envelope refused here stays in that sender's own queue, where the
   * sender can still account for it. */
  isFull(peerId: string): boolean {
    return isAtLimit(this.peerDir(peerId), this.limits);
  }

  /** Leftover `<seq>.json.<pid>.tmp` files from a crash between the write
   * and the rename — invisible to `list()`, so they would otherwise
   * accumulate forever. Mirrors OutboundQueue.reapStaleTemp. */
  private reapStaleTemp(): void {
    for (const peerId of this.peerIds()) {
      const dir = this.peerDir(peerId);
      let names: string[];
      try {
        names = readdirSync(dir);
      } catch {
        continue;
      }
      for (const name of names) {
        if (!name.endsWith('.tmp')) continue;
        try {
          unlinkSync(join(dir, name));
        } catch {
          // Already gone — fine.
        }
      }
    }
  }

  /** The boundary where a sender-supplied id would otherwise become a path
   * segment; see identifiers.ts. */
  private peerDir(peerId: string): string {
    return join(this.root, assertPeerId(peerId));
  }

  private fileName(seq: number): string {
    return `${String(seq).padStart(SEQ_PAD, '0')}.json`;
  }

  /** Durable write: temp file, then rename over the target — a reader never
   * observes a partial envelope. An existing file at this seq is left
   * untouched rather than rewritten: it is the sender's own resend of
   * something already durable here (the wire ack it is waiting for was
   * never the thing missing), not a collision to guard against. */
  enqueue(peerId: string, envelope: Envelope): void {
    const dir = this.peerDir(peerId);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const target = join(dir, this.fileName(envelope.seq));
    if (existsSync(target)) return;
    const tmp = `${target}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(envelope), { mode: 0o600 });
    renameSync(tmp, target);
  }

  /** Every envelope still waiting on a subscriber for `peerId`, oldest
   * (lowest seq) first. A file that cannot be parsed is skipped rather than
   * blocking everything behind it — the wire ack for it was already sent,
   * so there is no sender-side recovery path left to trigger, only a
   * best-effort skip. */
  list(peerId: string): Envelope[] {
    const dir = this.peerDir(peerId);
    if (!existsSync(dir)) return [];
    const names = readdirSync(dir)
      .filter((n) => n.endsWith('.json'))
      .sort();
    const out: Envelope[] = [];
    for (const name of names) {
      const parsed = this.tryRead(dir, name);
      if (parsed) out.push(parsed);
    }
    return out;
  }

  private tryRead(dir: string, name: string): Envelope | null {
    let raw: string;
    try {
      raw = readFileSync(join(dir, name), 'utf8');
    } catch {
      return null; // Removed concurrently (e.g. an ack racing this read).
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      return isEnvelope(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  /** Unlink the on-disk copy of `seq` from `peerId` — the *subscriber* ack
   * (docs/beam.md's "two acknowledgements"): an application has taken the
   * envelope, so this receiver no longer needs its own durable copy.
   * Idempotent, like OutboundQueue.remove. */
  remove(peerId: string, seq: number): void {
    try {
      unlinkSync(join(this.peerDir(peerId), this.fileName(seq)));
    } catch {
      // Already gone — fine, that is the point of unlinking.
    }
  }

  /** Every sender with envelopes still waiting here, for the node-start
   * redelivery scan. */
  peerIds(): string[] {
    if (!existsSync(this.root)) return [];
    return readdirSync(this.root, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  }
}
