/**
 * beam's control socket byte formats (beam docs/06): newline-delimited JSON
 * on a control connection, and on an attach connection the stream frames
 * of beam docs/04 — a type byte, a big-endian u32 length, the payload.
 * Pure, no I/O.
 */

export const FRAME = { data: 0, control: 1, close: 2 } as const;
export type FrameType = (typeof FRAME)[keyof typeof FRAME];

export interface Frame {
  type: FrameType;
  payload: Buffer;
}

/** beam docs/04: frame payload ≤ 1 MiB. */
const MAX_FRAME_PAYLOAD = 1 << 20;
/** beam docs/06: ≤ 1 MiB per control line. */
export const MAX_CONTROL_LINE = 1 << 20;

const HEADER = 5;

export function encodeFrame(type: FrameType, payload: Buffer): Buffer {
  const header = Buffer.alloc(HEADER);
  header[0] = type;
  header.writeUInt32BE(payload.length, 1);
  return Buffer.concat([header, payload]);
}

export function encodeJsonFrame(type: FrameType, value: unknown): Buffer {
  return encodeFrame(type, Buffer.from(JSON.stringify(value)));
}

function isFrameType(t: number): t is FrameType {
  return t === FRAME.data || t === FRAME.control || t === FRAME.close;
}

/** Reassembles frames from arbitrary chunks. Throws on a frame the
 *  protocol forbids; the caller ends the connection. */
export class FrameDecoder {
  private buffered = Buffer.alloc(0);

  push(chunk: Buffer): Frame[] {
    this.buffered = Buffer.concat([this.buffered, chunk]);
    const frames: Frame[] = [];
    while (this.buffered.length >= HEADER) {
      const type = this.buffered[0];
      if (!isFrameType(type)) throw new Error(`beam: frame type ${type}`);
      const length = this.buffered.readUInt32BE(1);
      if (length > MAX_FRAME_PAYLOAD) {
        throw new Error('beam: frame payload over 1 MiB');
      }
      if (this.buffered.length < HEADER + length) break;
      frames.push({
        type,
        payload: Buffer.from(this.buffered.subarray(HEADER, HEADER + length)),
      });
      this.buffered = this.buffered.subarray(HEADER + length);
    }
    return frames;
  }
}

/** Splits a byte stream into newline-terminated UTF-8 lines. */
export class LineDecoder {
  private buffered = Buffer.alloc(0);

  constructor(private readonly maxLine: number) {}

  push(chunk: Buffer): string[] {
    this.buffered = Buffer.concat([this.buffered, chunk]);
    const lines: string[] = [];
    let newline = this.buffered.indexOf(0x0a);
    while (newline !== -1) {
      lines.push(this.buffered.subarray(0, newline).toString('utf8'));
      this.buffered = this.buffered.subarray(newline + 1);
      newline = this.buffered.indexOf(0x0a);
    }
    if (this.buffered.length > this.maxLine) {
      throw new Error(`beam: a line longer than ${this.maxLine} bytes`);
    }
    return lines;
  }
}
