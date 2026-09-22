import { describe, expect, it } from 'vitest';

import {
  MAX_LABEL_LENGTH,
  MAX_TOPIC_LENGTH,
  isLabel,
  isPeerId,
  isTopic,
} from './identifiers.js';

describe('isPeerId', () => {
  it('accepts exactly what derivePeerId produces', () => {
    expect(isPeerId('00000000000000aa')).toBe(true);
    expect(isPeerId('0123456789abcdef')).toBe(true);
  });

  it('rejects anything that could steer a mailbox path', () => {
    for (const value of ['', '..', 'a/b', '0123456789ABCDEF', 'abc', 42]) {
      expect(isPeerId(value)).toBe(false);
    }
  });
});

describe('isLabel', () => {
  it('requires a non-empty, already-trimmed name within the length cap', () => {
    expect(isLabel('workbox')).toBe(true);
    expect(isLabel('')).toBe(false);
    expect(isLabel(' padded')).toBe(false);
    expect(isLabel('x'.repeat(MAX_LABEL_LENGTH))).toBe(true);
    expect(isLabel('x'.repeat(MAX_LABEL_LENGTH + 1))).toBe(false);
  });
});

describe('isTopic', () => {
  /** `--topic` is optional on `beam msg send` and its documented default is
   * the empty string, which means "no topic" — the same thing `msg listen`
   * means by an absent `--topic`, namely no filter. A topic is never a path
   * segment: the mailbox lays out `out/<peerId>/`, `in/<peerId>/` and
   * `seen/<peerId>.json`, so `peerId` is the only path-bearing identifier
   * and nothing downstream needs a topic to be non-empty. */
  it('accepts the empty topic', () => {
    expect(isTopic('')).toBe(true);
  });

  it('accepts an ordinary topic up to the length cap', () => {
    expect(isTopic('build.finished')).toBe(true);
    expect(isTopic('x'.repeat(MAX_TOPIC_LENGTH))).toBe(true);
  });

  it('still rejects an over-long topic', () => {
    expect(isTopic('x'.repeat(MAX_TOPIC_LENGTH + 1))).toBe(false);
  });

  it('still rejects what would confuse a path, a parser or a terminal', () => {
    const forbidden = [
      'a/b',
      'a\\b',
      'has{brace}',
      'has}brace',
      `nul${String.fromCharCode(0)}`,
      `bell${String.fromCharCode(7)}`,
      `c1${String.fromCharCode(0x9f)}`,
    ];
    for (const value of forbidden) expect(isTopic(value)).toBe(false);
  });

  it('rejects a non-string', () => {
    expect(isTopic(undefined)).toBe(false);
    expect(isTopic(42)).toBe(false);
  });
});
