import { describe, expect, it } from 'vitest';
import { parseStreamId, wrapStreamId } from './beam-stream-id.js';

describe('beam-stream-id', () => {
  it('round-trips generation and raw id', () => {
    const wrapped = wrapStreamId(3, 'pty-1');
    expect(wrapped).toBe('3:pty-1');
    expect(parseStreamId(wrapped)).toEqual({ generation: 3, rawId: 'pty-1' });
  });

  it('rejects an id with no generation prefix', () => {
    expect(parseStreamId('pty-1')).toBeNull();
  });

  it('rejects a non-numeric generation', () => {
    expect(parseStreamId('abc:pty-1')).toBeNull();
  });

  it('keeps a raw id that itself contains a colon intact', () => {
    expect(parseStreamId('2:pty-1:extra')).toEqual({
      generation: 2,
      rawId: 'pty-1:extra',
    });
  });
});
