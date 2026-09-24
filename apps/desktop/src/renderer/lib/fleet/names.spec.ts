import { describe, expect, it } from 'vitest';
import { NAME_RULE, nameError } from './names.js';

describe('nameError', () => {
  it('accepts blank, which means beam’s default', () => {
    expect(nameError('')).toBeNull();
  });

  it('accepts 1–64 Unicode scalar values, counting astral characters once', () => {
    expect(nameError('a')).toBeNull();
    expect(nameError('x'.repeat(64))).toBeNull();
    expect(nameError('😀'.repeat(64))).toBeNull();
    expect(nameError('Hermann’s laptop — ünïcode')).toBeNull();
  });

  it('refuses a 65th character rather than cutting it', () => {
    expect(nameError('x'.repeat(65))).toBe(NAME_RULE);
    expect(nameError('😀'.repeat(65))).toBe(NAME_RULE);
  });

  it('refuses the four reserved characters', () => {
    for (const c of ['/', '\\', '{', '}']) {
      expect(nameError(`a${c}b`)).toBe(NAME_RULE);
    }
  });

  it('refuses C0 and C1 controls and DEL, as beam’s unicode.IsControl does', () => {
    for (const c of [
      '\u0000',
      '\t',
      '\n',
      '\u001f',
      '\u007f',
      '\u0080',
      '\u009f',
    ]) {
      expect(nameError(`a${c}b`)).toBe(NAME_RULE);
    }
  });

  it('refuses a lone surrogate, which is not a scalar value', () => {
    expect(nameError('a\ud800b')).toBe(NAME_RULE);
  });

  it('does not trim: surrounding spaces are part of the name', () => {
    expect(nameError(' laptop ')).toBeNull();
  });
});
