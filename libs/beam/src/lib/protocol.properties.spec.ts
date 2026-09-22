import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  FrameDecoder,
  FrameType,
  encodeFrame,
  type Frame,
} from './protocol.js';

const frameArb = fc.record({
  type: fc.constantFrom(
    FrameType.Open,
    FrameType.Data,
    FrameType.Close,
    FrameType.Control
  ),
  streamId: fc.integer({ min: 0, max: 0xffff }),
  payload: fc.uint8Array({ minLength: 0, maxLength: 64 }),
});

/**
 * Arbitrary frame sequences, re-sequenced per stream so `encodeFrame`'s own
 * seq validation never rejects the fixture, then cut at every possible byte
 * boundary. This is the property that matters for a streaming decoder: no
 * matter how the transport slices the bytes, the same frames come out.
 */
const fragmentedStreamArb = fc
  .array(frameArb, { minLength: 1, maxLength: 8 })
  .chain((specs) => {
    const seqByStream = new Map<number, number>();
    const frames: Frame[] = specs.map((spec) => {
      const seq = seqByStream.get(spec.streamId) ?? 0;
      seqByStream.set(spec.streamId, seq + 1);
      return { ...spec, seq };
    });
    const encoded = frames.map((frame) => encodeFrame(frame));
    const total = encoded.reduce((sum, bytes) => sum + bytes.byteLength, 0);
    const joined = new Uint8Array(total);
    let offset = 0;
    for (const bytes of encoded) {
      joined.set(bytes, offset);
      offset += bytes.byteLength;
    }
    return fc.tuple(
      fc.constant(frames),
      fc.constant(joined),
      fc.subarray(range(1, total), { minLength: 0 })
    );
  });

/** All integers in [start, end), used to pick cut points inside the buffer. */
function range(start: number, end: number): number[] {
  return Array.from({ length: Math.max(0, end - start) }, (_, i) => start + i);
}

describe('FrameDecoder fragmentation property', () => {
  it('reassembles the original frames regardless of chunk boundaries', () => {
    fc.assert(
      fc.property(fragmentedStreamArb, ([frames, joined, rawCuts]) => {
        const cuts = [...new Set(rawCuts)].sort((a, b) => a - b);
        const decoder = new FrameDecoder();
        const got: Frame[] = [];
        let offset = 0;
        for (const cut of [...cuts, joined.byteLength]) {
          got.push(...decoder.push(joined.slice(offset, cut)));
          offset = cut;
        }
        expect(got).toEqual(frames);
        expect(decoder.pending).toBe(0);
      }),
      { numRuns: 200 }
    );
  });
});
