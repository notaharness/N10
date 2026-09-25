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

export function installWindowDiagnostics(win: BrowserWindow): void {
  const contents = win.webContents;
  contents.on('console-message', (details) => {
    if (details.level !== 'error') return;
    const where = details.sourceId
      ? ` (${details.sourceId}:${details.lineNumber})`
      : '';
    log('error', `renderer: ${details.message}${where}`);
  });

  let failures = 0;
  let retry: NodeJS.Timeout | null = null;
  contents.on('did-finish-load', () => {
    failures = 0;
  });
  contents.on(
    'did-fail-load',
    (_event, code, description, url, isMainFrame) => {
      if (!isMainFrame || code === ERR_ABORTED) return;
      failures += 1;
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
