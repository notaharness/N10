import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LOG_ROTATE_BYTES, log, openDesktopLog } from './log.js';

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
  it('appends timestamped lines to desktop.log under the given directory', () => {
    const path = openDesktopLog(join(dir, 'logs'));
    log('info', 'renderer loaded');
    log('error', 'GPU process gone: crashed');
    const lines = readFileSync(path, 'utf8').trimEnd().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z info {2}renderer loaded$/
    );
    expect(lines[1]).toMatch(/ error GPU process gone: crashed$/);
  });

  it('still prints to the console, at the matching level', () => {
    openDesktopLog(dir);
    log('warn', 'renderer unresponsive');
    expect(console.warn).toHaveBeenCalledWith(
      '[desktop] renderer unresponsive'
    );
  });

  it('rotates a log that has outgrown the limit when opened', () => {
    const path = join(dir, 'desktop.log');
    writeFileSync(path, 'x'.repeat(LOG_ROTATE_BYTES + 1));
    openDesktopLog(dir);
    log('info', 'fresh');
    expect(readFileSync(`${path}.1`, 'utf8')).toHaveLength(
      LOG_ROTATE_BYTES + 1
    );
    expect(readFileSync(path, 'utf8')).toMatch(/ info {2}fresh\n$/);
  });
});
