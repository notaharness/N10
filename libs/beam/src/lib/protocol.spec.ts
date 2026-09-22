import { describe, expect, it } from 'vitest';
import {
  FRAME_HEADER_SIZE,
  FRAME_VERSION,
  FrameDecoder,
  FrameType,
  MAX_PAYLOAD,
  ProtocolError,
  SeqSender,
  SeqTracker,
  encodeControl,
  encodeFrame,
  decodeControl,
  decodeText,
} from './protocol.js';

/** Run `fn`, returning the error it threw (or undefined). Keeps assertions
 * about the caught error out of the `catch` block itself, which vitest's
 * no-conditional-expect rule treats as a conditional assertion. */
function captureError(fn: () => void): unknown {
  try {
    fn();
    return undefined;
  } catch (error) {
    return error;
  }
}

describe('encodeFrame / FrameDecoder round trip', () => {
  it('decodes exactly what was encoded, in one chunk', () => {
    const payload = new TextEncoder().encode('hello beam');
    const bytes = encodeFrame({
      type: FrameType.Data,
      streamId: 7,
      seq: 3,
      payload,
    });
    const decoder = new FrameDecoder();
    const frames = decoder.push(bytes);
    expect(frames).toHaveLength(1);
    expect(frames[0]).toEqual({
      type: FrameType.Data,
      streamId: 7,
      seq: 3,
      payload,
    });
  });

  it('buffers a partial frame and completes it on the next chunk', () => {
    const payload = new TextEncoder().encode('split across chunks');
    const bytes = encodeFrame({
      type: FrameType.Data,
      streamId: 1,
      seq: 0,
      payload,
    });
    const decoder = new FrameDecoder();
    const splitPoint = FRAME_HEADER_SIZE + 3;
    const first = decoder.push(bytes.slice(0, splitPoint));
    expect(first).toHaveLength(0);
    expect(decoder.pending).toBe(splitPoint);
    const rest = decoder.push(bytes.slice(splitPoint));
    expect(rest).toHaveLength(1);
    expect(rest[0].payload).toEqual(payload);
  });

  it('decodes several frames delivered in a single chunk', () => {
    const a = encodeFrame({
      type: FrameType.Data,
      streamId: 1,
      seq: 0,
      payload: new Uint8Array([1]),
    });
    const b = encodeFrame({
      type: FrameType.Data,
      streamId: 1,
      seq: 1,
      payload: new Uint8Array([2]),
    });
    const merged = new Uint8Array(a.byteLength + b.byteLength);
    merged.set(a);
    merged.set(b, a.byteLength);
    const decoder = new FrameDecoder();
    const frames = decoder.push(merged);
    expect(frames.map((f) => f.seq)).toEqual([0, 1]);
  });

  it('rejects a frame with the wrong version byte', () => {
    const bytes = encodeFrame({
      type: FrameType.Data,
      streamId: 0,
      seq: 0,
      payload: new Uint8Array(0),
    });
    const corrupted = new Uint8Array(bytes);
    corrupted[0] = FRAME_VERSION + 1;
    const decoder = new FrameDecoder();
    const error = captureError(() => decoder.push(corrupted));
    expect(error).toBeInstanceOf(ProtocolError);
    expect((error as ProtocolError).kind).toBe('bad-version');
  });

  it('rejects a frame with an unknown type byte', () => {
    const bytes = encodeFrame({
      type: FrameType.Data,
      streamId: 0,
      seq: 0,
      payload: new Uint8Array(0),
    });
    const corrupted = new Uint8Array(bytes);
    corrupted[1] = 99;
    const decoder = new FrameDecoder();
    const error = captureError(() => decoder.push(corrupted));
    expect(error).toBeInstanceOf(ProtocolError);
    expect((error as ProtocolError).kind).toBe('bad-type');
  });

  it('rejects a declared length larger than MAX_PAYLOAD before buffering it', () => {
    const header = new Uint8Array(FRAME_HEADER_SIZE);
    const view = new DataView(header.buffer);
    view.setUint8(0, FRAME_VERSION);
    view.setUint8(1, FrameType.Data);
    view.setUint16(2, 0, false);
    view.setUint32(4, 0, false);
    view.setUint32(8, MAX_PAYLOAD + 1, false);
    const decoder = new FrameDecoder();
    const error = captureError(() => decoder.push(header));
    expect(error).toBeInstanceOf(ProtocolError);
    expect((error as ProtocolError).kind).toBe('payload-too-large');
  });

  it('flags truncated input when the stream ends mid-frame', () => {
    const bytes = encodeFrame({
      type: FrameType.Data,
      streamId: 0,
      seq: 0,
      payload: new Uint8Array([1, 2, 3, 4]),
    });
    const decoder = new FrameDecoder();
    decoder.push(bytes.slice(0, FRAME_HEADER_SIZE + 2));
    const error = captureError(() => decoder.finish());
    expect(error).toBeInstanceOf(ProtocolError);
    expect((error as ProtocolError).kind).toBe('truncated');
  });

  it('does not flag truncated when nothing is pending', () => {
    const decoder = new FrameDecoder();
    expect(() => decoder.finish()).not.toThrow();
  });
});

describe('control helpers', () => {
  it('round-trips a JSON control message', () => {
    const bytes = encodeControl({ kind: 'ping', t: 42 });
    const decoder = new FrameDecoder();
    const [frame] = decoder.push(bytes);
    expect(decodeControl(frame)).toEqual({ kind: 'ping', t: 42 });
  });

  it('decodes UTF-8 text payloads', () => {
    const bytes = encodeFrame({
      type: FrameType.Close,
      streamId: 2,
      seq: 0,
      payload: new TextEncoder().encode('bye'),
    });
    const decoder = new FrameDecoder();
    const [frame] = decoder.push(bytes);
    expect(decodeText(frame)).toBe('bye');
  });
});

describe('SeqTracker', () => {
  it('accepts the first frame on a stream as ok', () => {
    const tracker = new SeqTracker();
    expect(tracker.feed(1, 0)).toBe('ok');
  });

  it('accepts increasing sequence numbers as ok', () => {
    const tracker = new SeqTracker();
    tracker.feed(1, 0);
    expect(tracker.feed(1, 1)).toBe('ok');
    expect(tracker.feed(1, 2)).toBe('ok');
  });

  it('flags a repeat of the last-accepted sequence as duplicate', () => {
    const tracker = new SeqTracker();
    tracker.feed(1, 0);
    tracker.feed(1, 1);
    expect(tracker.feed(1, 1)).toBe('duplicate');
  });

  it('flags a jump ahead as a gap', () => {
    const tracker = new SeqTracker();
    tracker.feed(1, 0);
    expect(tracker.feed(1, 5)).toBe('gap');
  });

  it('flags an old sequence arriving late as reorder', () => {
    const tracker = new SeqTracker();
    tracker.feed(1, 0);
    tracker.feed(1, 5);
    expect(tracker.feed(1, 2)).toBe('reorder');
  });

  it('tracks each stream independently', () => {
    const tracker = new SeqTracker();
    tracker.feed(1, 0);
    tracker.feed(1, 1);
    expect(tracker.feed(2, 0)).toBe('ok');
  });
});

describe('SeqSender', () => {
  it('claims increasing sequence numbers per stream starting at 0', () => {
    const sender = new SeqSender();
    expect(sender.claim(1)).toBe(0);
    expect(sender.claim(1)).toBe(1);
    expect(sender.claim(1)).toBe(2);
  });

  it('tracks each stream independently', () => {
    const sender = new SeqSender();
    sender.claim(1);
    sender.claim(1);
    expect(sender.claim(2)).toBe(0);
  });
});
