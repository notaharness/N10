/**
 * The mailbox envelope (docs/beam.md's durable mailbox section). beam never
 * parses `payload`; `topic` exists so a receiver can subscribe to what
 * concerns it.
 */

import { MAX_PAYLOAD } from '../protocol.js';

/** Cap on an envelope's *decoded* payload. The headroom up to the 1 MiB
 * frame limit is not slack: the wire form is `JSON.stringify(envelope)`,
 * and JSON escaping is not size-preserving — a control character is one
 * byte of utf8 and six of JSON (`\u0001`). Passing this cap is therefore
 * necessary but not sufficient; `envelopeFitsOneFrame` is what decides
 * whether the thing can actually be sent. */
export const MAX_PAYLOAD_BYTES = 256 * 1024;

/** The envelope's real wire size: what the flusher hands to the frame
 * encoder. */
export function serializedByteLength(envelope: Envelope): number {
  return Buffer.byteLength(JSON.stringify(envelope), 'utf8');
}

/** Whether this envelope can be put on the wire at all. An envelope that
 * cannot be encoded is not merely a failed send: the flusher always takes
 * the head of the queue, so one sitting there blocks every message behind
 * it for as long as it stays. */
export function envelopeFitsOneFrame(envelope: Envelope): boolean {
  return serializedByteLength(envelope) <= MAX_PAYLOAD;
}

export interface Envelope {
  id: string;
  from: string;
  to: string;
  /** Monotonic per (sender, recipient) pair, strictly increasing — see
   * SeqCounter and SeenTracker, which key on exactly that pair. */
  seq: number;
  topic: string;
  payload: string;
  encoding: 'utf8' | 'base64';
  createdAt: number;
}

export function payloadByteLength(
  envelope: Pick<Envelope, 'payload' | 'encoding'>
): number {
  return envelope.encoding === 'base64'
    ? Buffer.from(envelope.payload, 'base64').byteLength
    : Buffer.byteLength(envelope.payload, 'utf8');
}

/** Structural check used when reading an envelope back off disk or off the
 * wire — a value that fails this is treated as corrupt, never coerced. */
export function isEnvelope(value: unknown): value is Envelope {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r['id'] === 'string' &&
    typeof r['from'] === 'string' &&
    typeof r['to'] === 'string' &&
    typeof r['seq'] === 'number' &&
    typeof r['topic'] === 'string' &&
    typeof r['payload'] === 'string' &&
    (r['encoding'] === 'utf8' || r['encoding'] === 'base64') &&
    typeof r['createdAt'] === 'number'
  );
}
