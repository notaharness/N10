/**
 * beam frame protocol — pure codec, no I/O.
 *
 * A connection carries one control channel plus any number of named streams
 * over a single ordered transport (WebSocket today, WebRTC data channel or a
 * relay later). The wire format is deliberately trivial so any language can
 * speak it:
 *
 *   header (12 bytes)                          payload
 *   +--------+---------+-----------+----------+-----------+------------+
 *   | ver u8 | type u8 | sid u16be | seq u32be | len u32be |   bytes    |
 *   +--------+---------+-----------+----------+-----------+------------+
 *
 * `seq` counts frames per stream per direction starting at 0. Receivers feed
 * incoming frames through a SeqTracker: a jump signals lost frames, a repeat
 * signals a resend, both are the hook for reconnect/resync later.
 *
 * This codec is the part another implementation has to match byte for byte,
 * so keep it exact — see docs/beam.md at the repository root.
 */

export const FRAME_VERSION = 1;

/** Header size in bytes: 1 version + 1 type + 2 streamId + 4 seq + 4 length. */
export const FRAME_HEADER_SIZE = 12;

/** Hard cap on one frame's payload; protects decoders from garbage. */
export const MAX_PAYLOAD = 1 << 20;

/** The highest stream id the wire's 16-bit `sid` field can carry. Id 0 is
 * the connection's own control channel, so a stream never uses it. */
export const MAX_STREAM_ID = 0xffff;

/** The largest a single transport message may legitimately be: one frame,
 * header included. Transports cap themselves here so an oversized message
 * is refused as it arrives, rather than being buffered and concatenated in
 * full before the decoder gets a chance to reject it. */
export const MAX_TRANSPORT_MESSAGE_BYTES = FRAME_HEADER_SIZE + MAX_PAYLOAD;

export const FrameType = {
  /** Open stream `streamId`. Payload: UTF-8 stream name. */
  Open: 0,
  /** Stream bytes. */
  Data: 1,
  /** Close stream `streamId`; payload may carry a UTF-8 reason. */
  Close: 2,
  /** Connection-level JSON message (pings, resizes, acks, capability chatter). */
  Control: 3,
} as const;

export type FrameTypeValue = (typeof FrameType)[keyof typeof FrameType];

export interface Frame {
  type: FrameTypeValue;
  streamId: number;
  seq: number;
  payload: Uint8Array;
}

export type ProtocolErrorKind =
  | 'bad-version'
  | 'bad-type'
  | 'payload-too-large'
  | 'truncated';

export class ProtocolError extends Error {
  constructor(public readonly kind: ProtocolErrorKind, message: string) {
    super(message);
    this.name = 'ProtocolError';
  }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const VALID_TYPES: ReadonlySet<number> = new Set(Object.values(FrameType));

function checkStreamId(streamId: number): void {
  if (!Number.isInteger(streamId) || streamId < 0 || streamId > MAX_STREAM_ID) {
    throw new RangeError(`streamId out of range: ${streamId}`);
  }
}

function checkSeq(seq: number): void {
  if (!Number.isInteger(seq) || seq < 0 || seq > 0xffffffff) {
    throw new RangeError(`seq out of range: ${seq}`);
  }
}

/** Encode one frame into a fresh buffer. */
export function encodeFrame(frame: Frame): Uint8Array {
  const { type, streamId, seq, payload } = frame;
  if (!VALID_TYPES.has(type))
    throw new RangeError(`unknown frame type: ${type}`);
  if (payload.byteLength > MAX_PAYLOAD) {
    throw new ProtocolError(
      'payload-too-large',
      `payload of ${payload.byteLength} bytes exceeds ${MAX_PAYLOAD}`
    );
  }
  checkStreamId(streamId);
  checkSeq(seq);
  const out = new Uint8Array(FRAME_HEADER_SIZE + payload.byteLength);
  const view = new DataView(out.buffer);
  view.setUint8(0, FRAME_VERSION);
  view.setUint8(1, type);
  view.setUint16(2, streamId, false);
  view.setUint32(4, seq, false);
  view.setUint32(8, payload.byteLength, false);
  out.set(payload, FRAME_HEADER_SIZE);
  return out;
}

/**
 * Incremental decoder: feed it network chunks in any fragmentation and it
 * yields complete frames, buffering the remainder.
 */
export class FrameDecoder {
  private buffer: Uint8Array = new Uint8Array(0);

  /** Feed raw bytes; returns every frame that became complete. */
  push(chunk: Uint8Array): Frame[] {
    this.buffer = concat(this.buffer, chunk);
    const frames: Frame[] = [];
    let offset = 0;
    while (this.buffer.byteLength - offset >= FRAME_HEADER_SIZE) {
      const parsed = this.tryParseOne(offset);
      if (!parsed) break;
      frames.push(parsed.frame);
      offset = parsed.nextOffset;
    }
    if (offset > 0) this.buffer = this.buffer.slice(offset);
    return frames;
  }

  /**
   * Call when the transport has ended (socket closed, connection dropped).
   * Throws `truncated` when bytes are still buffered waiting for the rest
   * of a frame that will now never arrive — a live frame mid-flight is not
   * an error (see `pending`), but one that can never complete is.
   */
  finish(): void {
    if (this.buffer.byteLength > 0) {
      throw new ProtocolError(
        'truncated',
        `stream ended with ${this.buffer.byteLength} buffered bytes`
      );
    }
  }

  /** Bytes buffered waiting for the rest of a frame. */
  get pending(): number {
    return this.buffer.byteLength;
  }

  private tryParseOne(
    offset: number
  ): { frame: Frame; nextOffset: number } | null {
    const view = new DataView(
      this.buffer.buffer,
      this.buffer.byteOffset + offset
    );
    const version = view.getUint8(0);
    if (version !== FRAME_VERSION) {
      throw new ProtocolError(
        'bad-version',
        `frame version ${version}, expected ${FRAME_VERSION}`
      );
    }
    const type = view.getUint8(1);
    if (!VALID_TYPES.has(type)) {
      throw new ProtocolError('bad-type', `unknown frame type ${type}`);
    }
    const payloadLen = view.getUint32(8, false);
    if (payloadLen > MAX_PAYLOAD) {
      throw new ProtocolError(
        'payload-too-large',
        `declared payload of ${payloadLen} bytes exceeds ${MAX_PAYLOAD}`
      );
    }
    const total = FRAME_HEADER_SIZE + payloadLen;
    if (this.buffer.byteLength - offset < total) return null;
    const streamId = view.getUint16(2, false);
    const seq = view.getUint32(4, false);
    const payload = this.buffer.slice(
      offset + FRAME_HEADER_SIZE,
      offset + total
    );
    return {
      frame: { type: type as FrameTypeValue, streamId, seq, payload },
      nextOffset: offset + total,
    };
  }
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const merged = new Uint8Array(a.byteLength + b.byteLength);
  merged.set(a);
  merged.set(b, a.byteLength);
  return merged;
}

/** Convenience: encode with a UTF-8 string payload. */
export function encodeText(
  type: FrameTypeValue,
  streamId: number,
  seq: number,
  text: string
): Uint8Array {
  return encodeFrame({ type, streamId, seq, payload: encoder.encode(text) });
}

/** Encode a connection-level Control frame carrying a JSON message. */
export function encodeControl(message: unknown, streamId = 0): Uint8Array {
  return encodeText(FrameType.Control, streamId, 0, JSON.stringify(message));
}

/** Decode a Control frame's JSON payload. */
export function decodeControl<T>(frame: Frame): T {
  return JSON.parse(decoder.decode(frame.payload)) as T;
}

/**
 * Which stream a frame concerns. Open, Data and Close carry it in the
 * header; a Control frame rides the connection's own id 0 and names its
 * stream inside the JSON payload, so that is where the id has to come
 * from. Falls back to the header's id for a payload that names none.
 */
export function frameStreamId(frame: Frame): number {
  if (frame.type !== FrameType.Control) return frame.streamId;
  try {
    const parsed: unknown = JSON.parse(decoder.decode(frame.payload));
    if (typeof parsed === 'object' && parsed !== null) {
      const id = (parsed as Record<string, unknown>)['streamId'];
      if (typeof id === 'number') return id;
    }
  } catch {
    // Not a JSON control message; the header's id is all there is.
  }
  return frame.streamId;
}

/** Convenience: decode a payload as UTF-8 text. */
export function decodeText(frame: Frame): string {
  return decoder.decode(frame.payload);
}

/**
 * Receiver-side sequence accounting. One instance per direction; each stream
 * starts at FIRST_SEQ and must increment without gaps.
 */
export const FIRST_SEQ = 0;

export type SeqVerdict = 'ok' | 'duplicate' | 'gap' | 'reorder';

export class SeqTracker {
  private expected = new Map<number, number>();

  /** Record the next frame on `streamId` and judge its sequence number. */
  feed(streamId: number, seq: number): SeqVerdict {
    const next = this.expected.get(streamId) ?? FIRST_SEQ;
    if (seq === next - 1 && next !== FIRST_SEQ) return 'duplicate';
    if (seq === next) {
      this.expected.set(streamId, next + 1);
      return 'ok';
    }
    // Anything else: ahead of us (gap — we lost frames) or behind (reorder).
    this.expected.set(streamId, Math.max(next, seq + 1));
    return seq > next ? 'gap' : 'reorder';
  }

  /** The sequence number the given stream expects next. */
  expectedSeq(streamId: number): number {
    return this.expected.get(streamId) ?? FIRST_SEQ;
  }
}

/** Sender-side sequence counter for one direction. */
export class SeqSender {
  private next = new Map<number, number>();

  /** Claim the sequence number for the outgoing frame on `streamId`. */
  claim(streamId: number): number {
    const seq = this.next.get(streamId) ?? FIRST_SEQ;
    this.next.set(streamId, seq + 1);
    return seq;
  }

  /** The number `claim` would hand out next, without claiming it. Lets a
   * sender encode a frame before committing to its seq: a number claimed
   * for a frame that then fails to encode is a hole in the stream, and the
   * receiver reads a hole as lost data and fails the stream over it. */
  peek(streamId: number): number {
    return this.next.get(streamId) ?? FIRST_SEQ;
  }
}
