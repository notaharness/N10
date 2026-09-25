/**
 * The desktop log: one line per event that explains a window which is
 * not what the user expects — a process death, a hang, a load that
 * failed, an exception in the renderer. Lines go to the console as
 * before and to `<userData>/logs/desktop.log`, because the terminal a
 * dev run printed to is gone by the time anyone asks what happened.
 */
import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';

export type LogLevel = 'info' | 'warn' | 'error';

/** The log is rotated once, to `desktop.log.1`, when it grows past this. */
export const LOG_ROTATE_BYTES = 1_000_000;

let file: string | null = null;

/**
 * Start writing to `<dir>/desktop.log`, rotating a file that has grown
 * past the limit. Returns the path so the app can show it.
 */
export function openDesktopLog(dir: string): string {
  const path = join(dir, 'desktop.log');
  try {
    mkdirSync(dir, { recursive: true });
    if (statSync(path).size > LOG_ROTATE_BYTES) renameSync(path, `${path}.1`);
  } catch {
    // no file yet, or nothing we can do about the directory
  }
  file = path;
  return path;
}

export function desktopLogPath(): string | null {
  return file;
}

/** Log `message` at `level`, on the console and in the file. */
export function log(level: LogLevel, message: string): void {
  const print =
    level === 'error'
      ? console.error
      : level === 'warn'
        ? console.warn
        : console.log;
  print(`[desktop] ${message}`);
  if (!file) return;
  try {
    appendFileSync(
      file,
      `${new Date().toISOString()} ${level.padEnd(5)} ${message}\n`
    );
  } catch {
    // a full or read-only disk must not take the app down
  }
}
