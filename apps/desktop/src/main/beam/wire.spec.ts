import { describe, expect, it } from 'vitest';
import {
  FRAME,
  FrameDecoder,
  LineDecoder,
  encodeFrame,
  type Frame,
} from './wire.js';

function decodeAll(chunks: Buffer[]): Frame[] {
  const decoder = new FrameDecoder();
  return chunks.flatMap((c) => decoder.push(c));
}

describe('encodeFrame', () => {
  it('writes the type byte, a big-endian u32 length, then the payload', () => {
    const bytes = encodeFrame(FRAME.control, Buffer.from('{"kind":"taken"}'));
    expect(bytes[0]).toBe(1);
    expect(bytes.readUInt32BE(1)).toBe(16);
    expect(bytes.subarray(5).toString()).toBe('{"kind":"taken"}');
  });
});

describe('FrameDecoder', () => {
  const frames = [
    encodeFrame(FRAME.data, Buffer.from('hello')),
    encodeFrame(FRAME.control, Buffer.from('{"kind":"taken"}')),
    encodeFrame(FRAME.data, Buffer.alloc(0)),
    encodeFrame(FRAME.close, Buffer.from('{"reason":"exit","exitCode":0}')),
  ];
  const expected: Frame[] = [
    { type: FRAME.data, payload: Buffer.from('hello') },
    { type: FRAME.control, payload: Buffer.from('{"kind":"taken"}') },
    { type: FRAME.data, payload: Buffer.alloc(0) },
    {
      type: FRAME.close,
      payload: Buffer.from('{"reason":"exit","exitCode":0}'),
    },
  ];

  it('decodes frames that arrive together', () => {
    expect(decodeAll([Buffer.concat(frames)])).toEqual(expected);
  });

  it('decodes frames split at every byte boundary', () => {
    const all = Buffer.concat(frames);
    for (let cut = 1; cut < all.length; cut++) {
      expect(decodeAll([all.subarray(0, cut), all.subarray(cut)])).toEqual(
        expected
      );
    }
  });

  it('refuses a payload over 1 MiB rather than buffering it', () => {
    const header = Buffer.alloc(5);
    header[0] = FRAME.data;
    header.writeUInt32BE(1024 * 1024 + 1, 1);
    expect(() => decodeAll([header])).toThrow(/1 MiB/);
  });

  it('refuses an unknown frame type', () => {
    const header = Buffer.alloc(5);
    header[0] = 7;
    expect(() => decodeAll([header])).toThrow(/frame type 7/);
  });
});

describe('LineDecoder', () => {
  it('splits on newlines and keeps a partial line for the next chunk', () => {
    const lines = new LineDecoder(1024);
    expect(lines.push(Buffer.from('{"a":1}\n{"b"'))).toEqual(['{"a":1}']);
    expect(lines.push(Buffer.from(':2}\n'))).toEqual(['{"b":2}']);
  });

  it('keeps a multi-byte character split across chunks whole', () => {
    const lines = new LineDecoder(1024);
    const bytes = Buffer.from('"é"\n');
    expect(lines.push(bytes.subarray(0, 2))).toEqual([]);
    expect(lines.push(bytes.subarray(2))).toEqual(['"é"']);
  });

  it('refuses a line longer than its limit', () => {
    const lines = new LineDecoder(8);
    expect(() => lines.push(Buffer.from('0123456789'))).toThrow(/longer/);
  });
});
