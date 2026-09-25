/**
 * `[desktop]` lines go to the console as before and, through
 * `@n10/logger`, to `<userData>/logs/desktop.log` beside what core logs
 * from inside this process — the terminal a dev run printed to is gone
 * by the time anyone asks what happened.
 */
import { log as write, setLogFile, type LogLevel } from '@n10/logger';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const ROTATE_BYTES = 1_000_000;

/** Start writing to `<dir>/desktop.log`; returns the path. */
export function openDesktopLog(dir: string): string {
  const path = join(dir, 'desktop.log');
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    // the file write reports it
  }
  setLogFile(path, ROTATE_BYTES);
  return path;
}

export function log(level: Exclude<LogLevel, 'debug'>, message: string): void {
  const print =
    level === 'error'
      ? console.error
      : level === 'warn'
      ? console.warn
      : console.log;
  print(`[desktop] ${message}`);
  try {
    write(level, 'desktop', message);
  } catch {
    // a full or read-only disk must not take the app down
  }
}
