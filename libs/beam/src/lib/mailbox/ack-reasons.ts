/**
 * The `reason` strings a refusing ack carries, and the one thing the
 * sender needs from them: whether sending this envelope again could ever
 * produce a different answer.
 *
 * Both halves of the mailbox read this file. `InboundReceiver` writes these
 * strings onto `{ kind: 'ack', accepted: false, reason }`; `Flusher` reads
 * them to decide between retrying the head of the queue and quarantining
 * it. They were two sets of inline literals before, which is exactly how a
 * sender ends up retrying a refusal that can never change.
 *
 * See docs/beam.md's "Durable mailbox".
 */

/** The envelope is bigger than the receiver will ever store — over the
 * 256 KiB payload cap, or its serialized form is over `MAX_PAYLOAD`. The
 * bytes are fixed and the cap is in the protocol, so every resend of this
 * envelope is refused identically. */
export const ACK_REASON_OVER_CAP = 'payload over the cap';

/** This node's inbound queue for that sender is at its depth or byte
 * bound. Transient: a subscriber taking what is already stored frees it. */
export const ACK_REASON_QUEUE_FULL = 'inbound queue is full';

/** `mailbox/seen/<peerId>.json` could not be read, so the receiver cannot
 * tell this envelope from one it already took. Transient in the sense that
 * matters here: it is repaired by fixing the file, not by the sender
 * throwing the message away. */
export const ACK_REASON_SEEN_UNREADABLE = 'seen state unreadable';

/** Refusals no resend can ever get past. Deliberately a closed allow-list
 * rather than a deny-list of the transient ones: an ack reason this
 * version does not recognise — an older or newer peer, or a future
 * refusal — is treated as transient and retried. Retrying something
 * permanent wastes a connection; quarantining something transient
 * destroys a message the caller was already told was durable, which is
 * the one promise this mailbox exists to keep. */
const PERMANENT_REFUSALS: ReadonlySet<string> = new Set([ACK_REASON_OVER_CAP]);

/** Whether a refusing ack's `reason` means "never, no matter how often you
 * try". An absent reason (an ack timeout, or a peer that refused without
 * saying why) is transient. */
export function isPermanentRefusal(reason: unknown): boolean {
  return typeof reason === 'string' && PERMANENT_REFUSALS.has(reason);
}
