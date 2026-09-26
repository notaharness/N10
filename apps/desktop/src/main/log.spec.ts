import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { log, openDesktopLog } from './log.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'n10-log-'));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

describe('desktop log', () => {
  it('writes desktop.log under the given directory, creating it', () => {
    const path = openDesktopLog(join(dir, 'logs'));
    log('info', 'renderer loaded');
    log('error', 'GPU process gone: crashed');
    const lines = readFileSync(path, 'utf8').trimEnd().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z \[INFO\] desktop: renderer loaded$/
    );
    expect(lines[1]).toMatch(/ \[ERROR\] desktop: GPU process gone: crashed$/);
  });

  it('keeps an explicit N10_LOG path', () => {
    const chosen = join(dir, 'chosen.log');
    vi.stubEnv('N10_LOG', chosen);
    try {
      expect(openDesktopLog(join(dir, 'logs'))).toBe(chosen);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('still prints to the console, at the matching level', () => {
    openDesktopLog(dir);
    log('warn', 'renderer unresponsive');
    expect(console.warn).toHaveBeenCalledWith(
      '[desktop] renderer unresponsive'
    );
  });
});
