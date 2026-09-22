/**
 * The receiving half of the durable mailbox: the `msg` stream handler,
 * receiver-side dedup, the durable inbound store, and the subscribers
 * waiting on it. Split from `Mailbox` so the sending and receiving halves
 * stay independently readable — docs/beam.md's "Durable mailbox" section is
 * what both implement.
 */

import { isPeerId, isTopic } from '../identifiers.js';
import type { BeamStream } from '../stream.js';
import {
  ACK_REASON_OVER_CAP,
  ACK_REASON_QUEUE_FULL,
  ACK_REASON_SEEN_UNREADABLE,
} from './ack-reasons.js';
import {
  envelopeFitsOneFrame,
  isEnvelope,
  MAX_PAYLOAD_BYTES,
  payloadByteLength,
  type Envelope,
} from './envelope.js';
import { InboundStore } from './inbound-store.js';
import type { QueueLimits } from './queue-limits.js';
import { MailboxCorruptionError, SeenTracker } from './seen-tracker.js';

/** A raw inbound subscriber: called once per accepted envelope (live or
 * replayed from the inbound store at subscribe time), with an
 * `acknowledge()` that must be called once it has been durably taken —
 * that is what unlinks this receiver's on-disk copy. Used by IpcSocket,
 * whose own subscriber ack is explicit and can arrive long after this call
 * returns; `Mailbox.onMessage` layers the simpler auto-ack API most callers
 * want on top of it. */
export type InboundHandler = (
  envelope: Envelope,
  acknowledge: () => void
) => void;

export interface InboundReceiverOptions {
  beamDir: string;
  onCorruption?: (error: MailboxCorruptionError) => void;
  limits?: Partial<QueueLimits>;
}

/** Both halves of the size contract: the documented payload cap, and the
 * frame the envelope actually has to fit in once serialized. */
/** Everything about an envelope that this node will go on to use as a path
 * segment or print where another tool parses it (identifiers.ts). An
 * envelope failing this is dropped rather than acked: it is not something
 * a conforming sender can produce. */
function wellFormed(envelope: Envelope): boolean {
  return (
    isPeerId(envelope.from) && isPeerId(envelope.to) && isTopic(envelope.topic)
  );
}

function withinCap(envelope: Envelope): boolean {
  return (
    payloadByteLength(envelope) <= MAX_PAYLOAD_BYTES &&
    envelopeFitsOneFrame(envelope)
  );
}

export class InboundReceiver {
  private readonly store: InboundStore;
  private readonly seen: SeenTracker;
  private readonly onCorruption?: (error: MailboxCorruptionError) => void;
  private readonly handlers: InboundHandler[] = [];

  constructor(options: InboundReceiverOptions) {
    this.store = new InboundStore(options.beamDir, options.limits);
    this.seen = new SeenTracker(options.beamDir);
    this.onCorruption = options.onCorruption;
  }

  /** Every raw handler gets called for every envelope this mailbox has
   * accepted and not yet had acknowledged by a subscriber, including
   * whatever was still sitting in the inbound store from a previous run
   * (D15: "on start, anything still there is redelivered" — a subscriber
   * that crashed, exited, or never attached loses nothing). Returns an
   * unsubscribe function. */
  subscribe(handler: InboundHandler): () => void {
    this.handlers.push(handler);
    for (const { peerId, envelope } of this.backlog()) {
      handler(envelope, () => this.store.remove(peerId, envelope.seq));
    }
    return () => {
      const i = this.handlers.indexOf(handler);
      if (i >= 0) this.handlers.splice(i, 1);
    };
  }

  /** Wire an inbound `msg` stream: ack the open, then take envelopes. */
  handleStream(stream: BeamStream): void {
    stream.control({ kind: 'opened' });
    stream.onData((data) => this.handleFrame(stream, data));
  }

  // Oldest first, across every sender — a per-sender backlog is already in
  // order (InboundStore.list sorts by seq); createdAt breaks ties across
  // senders into a stable overall receive order.
  private backlog(): { peerId: string; envelope: Envelope }[] {
    const out: { peerId: string; envelope: Envelope }[] = [];
    for (const peerId of this.store.peerIds()) {
      for (const envelope of this.store.list(peerId))
        out.push({ peerId, envelope });
    }
    return out.sort((a, b) => a.envelope.createdAt - b.envelope.createdAt);
  }

  private handleFrame(stream: BeamStream, data: Uint8Array): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(data));
    } catch {
      return; // Not JSON at all — nothing sane to ack; drop.
    }
    if (!isEnvelope(parsed) || parsed.from !== stream.peer.peerId) return;
    if (!wellFormed(parsed)) return;
    if (!withinCap(parsed)) {
      // The cap belongs to the mailbox, not only to this node's own
      // `send()`. A peer that ignores it would otherwise store here up to
      // the 1 MiB frame limit. Refused rather than stored, and said so:
      // an unaccepted envelope stays in the sender's queue, where the
      // sender is the side that can report the loss.
      //
      // This is the one *permanent* refusal (ack-reasons.ts). The bytes
      // cannot shrink and the cap is in the protocol, so the reason has
      // to be specific enough for the sender to tell it from the two
      // refusals below, which do clear on their own.
      stream.control({
        kind: 'ack',
        id: parsed.id,
        accepted: false,
        reason: ACK_REASON_OVER_CAP,
      });
      return;
    }
    if (this.store.isFull(stream.peer.peerId)) {
      // Refused, not stored: an envelope this node never accepted stays in
      // the sender's own queue, where the sender is the side that can
      // report it. Storing past the bound would instead let one peer whose
      // subscriber never attaches fill the disk.
      stream.control({
        kind: 'ack',
        id: parsed.id,
        accepted: false,
        reason: ACK_REASON_QUEUE_FULL,
      });
      return;
    }
    this.accept(stream, parsed);
  }

  private accept(stream: BeamStream, envelope: Envelope): void {
    const peerId = stream.peer.peerId;
    // No contiguity requirement (D1): anything greater than the last seq
    // seen from this sender is new. Accepted and duplicate both ack `true`
    // — a duplicate is exactly the resend a crash between the sender's
    // original delivery and its ack produces, and re-acking is what lets
    // the sender finally unlink it.
    try {
      if (this.seen.lastSeq(peerId) >= envelope.seq) {
        // Already accepted on a previous frame — and, since acceptance and
        // the wire ack always follow persistence (below), possibly already
        // taken by a subscriber and unlinked too. Re-ack without persisting
        // or redelivering to the application again.
        stream.control({ kind: 'ack', id: envelope.id, accepted: true });
        return;
      }
      // D15: durability before acknowledgement, mirroring the outbound
      // queue. This *wire* ack's whole meaning is "this machine has the
      // envelope on disk" — that is what lets the sender unlink its own
      // copy and report `delivered`. It is deliberately a different,
      // earlier thing than the *subscriber* ack, which means "an
      // application has taken it" and is the only thing that unlinks this
      // receiver's own copy. See docs/beam.md's "Durable mailbox" and its
      // two-acknowledgement table.
      this.store.enqueue(peerId, envelope);
      this.seen.accept(peerId, envelope.seq);
      stream.control({ kind: 'ack', id: envelope.id, accepted: true });
      for (const handler of this.handlers) {
        handler(envelope, () => this.store.remove(peerId, envelope.seq));
      }
    } catch (error) {
      if (!(error instanceof MailboxCorruptionError)) throw error;
      this.onCorruption?.(error);
      stream.control({
        kind: 'ack',
        id: envelope.id,
        accepted: false,
        reason: ACK_REASON_SEEN_UNREADABLE,
      });
    }
  }
}
