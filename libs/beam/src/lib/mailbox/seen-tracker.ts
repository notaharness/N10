/**
 * Receiver-side dedup: `mailbox/seen/<peerId>.json` persists the highest
 * accepted seq from that sender. At-least-once delivery on the wire plus
 * this dedup is what makes the receiving application see each message
 * exactly once, in order. See docs/beam.md.
 *
 * There is no contiguity requirement: `accept` takes any `seq` greater than
 * the last one seen, not only `last + 1`. Ordering still holds regardless —
 * the sender drains its queue strictly sequentially over one ordered
 * transport, so the receiver can never observe reordering. Contiguity never
 * provided that ordering; it only provided *detection* of a sender-side
 * loss (a gap), and the sender already knows about that loss on its own
 * side (an unrecoverable, quarantined queue file — see OutboundQueue). A
 * receiver that instead treated a gap as fatal had no way to recover from
 * one without the sender: a quarantined file's crash window between
 * quarantine and telling the receiver about it would wedge this pair
 * permanently, with no recovery but hand-deleting this file (D1).
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { assertPeerId } from '../identifiers.js';

/** A seen-state file exists but cannot be trusted. Thrown rather than
 * silently treated as "nothing seen yet" — that would risk re-accepting
 * (and re-delivering to the application) a message this node already
 * processed, which is exactly the exactly-once guarantee the mailbox
 * exists to provide. */
export class MailboxCorruptionError extends Error {
  constructor(public readonly peerId: string, message: string) {
    super(message);
    this.name = 'MailboxCorruptionError';
  }
}

export type AcceptVerdict = 'accepted' | 'duplicate';

export class SeenTracker {
  private readonly dir: string;

  constructor(beamDir: string) {
    this.dir = join(beamDir, 'mailbox', 'seen');
  }

  /** The boundary where a sender-supplied id would otherwise become a file
   * name; see identifiers.ts. */
  private path(peerId: string): string {
    return join(this.dir, `${assertPeerId(peerId)}.json`);
  }

  /** The highest seq accepted from `peerId`, or 0 if none yet. */
  lastSeq(peerId: string): number {
    const path = this.path(peerId);
    if (!existsSync(path)) return 0;
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(path, 'utf8'));
    } catch (error) {
      throw new MailboxCorruptionError(
        peerId,
        `seen state for ${peerId} is unreadable: ${(error as Error).message}`
      );
    }
    const lastSeq =
      typeof parsed === 'object' && parsed !== null
        ? (parsed as Record<string, unknown>)['lastSeq']
        : undefined;
    if (typeof lastSeq !== 'number') {
      throw new MailboxCorruptionError(
        peerId,
        `seen state for ${peerId} is malformed`
      );
    }
    return lastSeq;
  }

  /**
   * Judge `seq` from `peerId` and, if it is new, persist it in the same
   * step: anything at or below `last` is a duplicate (the resend a crash
   * between delivery and ack produces, or simply a sender retrying because
   * it never saw the ack) and must be re-acked without being delivered to
   * the application again; anything greater than `last` is accepted,
   * whether or not it is `last + 1` — see the class comment for why no
   * contiguity check is needed.
   */
  accept(peerId: string, seq: number): AcceptVerdict {
    const last = this.lastSeq(peerId);
    if (seq <= last) return 'duplicate';
    this.save(peerId, seq);
    return 'accepted';
  }

  private save(peerId: string, lastSeq: number): void {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const path = this.path(peerId);
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ lastSeq }), { mode: 0o600 });
    renameSync(tmp, path);
  }
}
