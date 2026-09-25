import { describe, it, expect } from 'vitest';
import { safeStringify } from './logger.js';

describe('safeStringify', () => {
  it('serializes plain objects via JSON.stringify', () => {
    expect(safeStringify({ a: 1, b: 'two' })).toBe('{"a":1,"b":"two"}');
  });

  it('formats Errors as message + stack', () => {
    const err = new Error('boom');
    err.stack = 'Error: boom\n    at fake:1:1';
    expect(safeStringify(err)).toBe('boom\nError: boom\n    at fake:1:1');
  });

  it('does not throw on circular references', () => {
    const circular: Record<string, unknown> = { name: 'self' };
    circular.self = circular;
    expect(() => safeStringify(circular)).not.toThrow();
    // Falls through to String(circular) — '[object Object]'
    expect(safeStringify(circular)).toBe('[object Object]');
  });

  it('does not throw on BigInt values', () => {
    expect(() => safeStringify({ big: 1n })).not.toThrow();
    // String({ big: 1n }) → '[object Object]'
    expect(safeStringify({ big: 1n })).toBe('[object Object]');
  });

  it('does not throw when toJSON itself throws', () => {
    const obj = {
      toJSON() {
        throw new Error('toJSON sabotage');
      },
    };
    expect(() => safeStringify(obj)).not.toThrow();
  });
});

describe('setLogFile', () => {
  it('writes to the given file and rotates it once past the limit', async () => {
    const { mkdtempSync, readFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { log, setLogFile } = await import('./logger.js');
    const dir = mkdtempSync(join(tmpdir(), 'n10-logger-'));
    const path = join(dir, 'app.log');
    try {
      setLogFile(path, 120);
      log('info', 'test', 'first line, about sixty bytes with its timestamp');
      log('info', 'test', 'second line, past the limit once it is appended');
      expect(readFileSync(`${path}.1`, 'utf8')).toMatch(/first line/);
      expect(readFileSync(path, 'utf8')).toMatch(/^[^\n]*second line[^\n]*\n$/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
