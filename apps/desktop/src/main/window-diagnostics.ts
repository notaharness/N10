/**
 * What the renderer says, and whether it loaded at all, in the log.
 *
 * An uncaught exception or an unhandled rejection in the renderer is
 * printed to its console and nowhere else; the root error boundary
 * shows the ones React sees, but a script that fails before React
 * mounts, or outside it, leaves a page with no explanation. Chromium
 * reports every console error to the main process, so they are logged
 * from here. A main-frame load that fails is logged too, and retried
 * with a growing delay: in development the page comes from the Vite
 * dev server, and a reload while that server is down or restarting
 * would otherwise leave the window blank until the app is restarted.
 */
import type { BrowserWindow } from 'electron';
import { log } from './log.js';

/** The delay before the load attempt after `failures` failed ones. */
export function loadRetryDelay(failures: number): number {
  return Math.min(1_000 * 2 ** Math.max(0, failures - 1), 10_000);
}

/** Chromium's ERR_ABORTED: a load replaced by another, not a failure. */
const ERR_ABORTED = -3;

function logConsoleErrors(win: BrowserWindow): void {
  // A renderer stuck in an error loop repeats one line per frame.
  let last = '';
  let repeats = 0;
  win.webContents.on('console-message', (details) => {
    if (details.level !== 'error') return;
    const where = details.sourceId
      ? ` (${details.sourceId}:${details.lineNumber})`
      : '';
    const line = `renderer: ${details.message}${where}`;
    if (line === last) {
      repeats += 1;
      return;
    }
    if (repeats > 0) log('error', `previous line repeated ${repeats} times`);
    last = line;
    repeats = 0;
    log('error', line);
  });
}

function retryFailedLoads(win: BrowserWindow): void {
  const contents = win.webContents;
  let failures = 0;
  let failed = false;
  let retry: NodeJS.Timeout | null = null;
  contents.on('did-finish-load', () => {
    // Chromium's error page finishes loading too, under the same URL.
    if (failed) {
      failed = false;
      return;
    }
    failures = 0;
    log('info', 'renderer loaded');
  });
  contents.on(
    'did-fail-load',
    (_event, code, description, url, isMainFrame) => {
      if (!isMainFrame || code === ERR_ABORTED) return;
      failed = true;
      failures += 1;
      // A file that is not there will not appear.
      if (url.startsWith('file:')) {
        log('error', `load of ${url} failed: ${description} (${code})`);
        return;
      }
      const delay = loadRetryDelay(failures);
      log(
        'error',
        `load of ${url} failed: ${description} (${code}); retrying in ${delay} ms`
      );
      if (retry) clearTimeout(retry);
      retry = setTimeout(() => {
        retry = null;
        if (win.isDestroyed() || contents.isDestroyed()) return;
        void contents.loadURL(url).catch(() => undefined);
      }, delay);
    }
  );
  win.on('closed', () => {
    if (retry) clearTimeout(retry);
  });
}

export function installWindowDiagnostics(win: BrowserWindow): void {
  logConsoleErrors(win);
  retryFailedLoads(win);
}
