import { appendFileSync, renameSync, statSync } from 'node:fs';

let logPath = process.env.N10_LOG || null;
let rotateAtBytes = Infinity;
let written = 0;

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

// Levels in increasing severity. Filter drops anything *below* the
// configured level. Default is `info` so high-volume `debug` (e.g.
// network traces) is opt-in via `N10_LOG_LEVEL=debug`.
const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function resolveMinLevel(): number {
  const raw = (process.env.N10_LOG_LEVEL || 'info').toLowerCase();
  if (raw in LEVEL_RANK) return LEVEL_RANK[raw as LogLevel];
  return LEVEL_RANK.info;
}

const minLevel = resolveMinLevel();

/**
 * Write to `path` instead of `$N10_LOG`. Once the file passes
 * `rotateBytes` it is moved to `<path>.1` and started over, so a
 * process that logs for weeks, or a renderer stuck in an error loop,
 * cannot fill the disk.
 */
export function setLogFile(path: string, rotateBytes = Infinity): void {
  logPath = path;
  rotateAtBytes = rotateBytes;
  try {
    written = statSync(path).size;
  } catch {
    written = 0;
  }
}

function write(line: string): void {
  if (!logPath) return;
  const bytes = Buffer.byteLength(line);
  if (written + bytes > rotateAtBytes) {
    try {
      renameSync(logPath, `${logPath}.1`);
    } catch {
      // nothing to rotate
    }
    written = 0;
  }
  appendFileSync(logPath, line);
  written += bytes;
}

/**
 * Format `data` as a single-line string for log output. Errors get
 * `message\nstack`; everything else goes through `JSON.stringify`.
 *
 * `JSON.stringify` throws on circular references, BigInt values, and
 * objects whose `toJSON` throws — none of which should tear down the
 * caller (e.g. `tracedFetch` would lose a reply mutation if a single
 * log line crashed). Fall back to `String(data)` so we always produce
 * something writable.
 */
export function safeStringify(data: unknown): string {
  if (data instanceof Error) return `${data.message}\n${data.stack ?? ''}`;
  try {
    return JSON.stringify(data);
  } catch {
    try {
      return String(data);
    } catch {
      return '[unserializable]';
    }
  }
}

export function log(
  level: LogLevel,
  context: string,
  message: string,
  data?: unknown
): void {
  if (!logPath) return;
  if (LEVEL_RANK[level] < minLevel) return;
  const ts = new Date().toISOString();
  const line =
    data !== undefined
      ? `${ts} [${level.toUpperCase()}] ${context}: ${message} ${safeStringify(
          data
        )}`
      : `${ts} [${level.toUpperCase()}] ${context}: ${message}`;
  write(line + '\n');
}

export function logError(context: string, err: unknown): void {
  const msg =
    err instanceof Error ? `${err.message}\n${err.stack}` : String(err);
  log('error', context, msg);
}

/**
 * Log a network request/response pair at `debug` level. Suppressed
 * unless `N10_LOG_LEVEL=debug` is set, so day-to-day runs don't
 * spam the log with every gh/ADO call.
 *
 * Caller is responsible for sanitizing — do NOT pass auth headers,
 * PATs, or full response bodies that might contain user content. Pass
 * a shape summary (counts, top-level keys, sampled IDs) instead.
 */
export function logNetwork(
  context: string,
  message: string,
  data?: unknown
): void {
  log('debug', context, message, data);
}
