/**
 * What happens when a process behind the window dies.
 *
 * Electron leaves a window whose renderer process is gone open and
 * blank: nothing reloads it, nothing closes it, and every push from the
 * host to it logs a stack. The host, its sessions and their scrollback
 * are all still here, so a reload rebuilds the page from them — unless
 * the renderer keeps dying, in which case the user is asked.
 */
import { app, dialog, powerMonitor, type BrowserWindow } from 'electron';
import { log } from './log.js';
import { reloadAfterRendererGone } from './window.js';

export function installRendererRecovery(win: BrowserWindow): void {
  let deaths: number[] = [];
  win.webContents.on('render-process-gone', (_event, details) => {
    if (win.isDestroyed() || win.webContents.isDestroyed()) return;
    const next = reloadAfterRendererGone(deaths, Date.now());
    deaths = next.history;
    log(
      'error',
      `renderer gone: ${details.reason} (exit code ${details.exitCode})${next.reload ? ', reloading' : ''}`
    );
    if (next.reload) {
      win.webContents.reload();
      return;
    }
    void dialog
      .showMessageBox(win, {
        type: 'error',
        message: 'The n10 window has crashed repeatedly.',
        detail: `Last reason: ${details.reason}. Agent sessions keep running in tmux either way.`,
        buttons: ['Reload', 'Quit'],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        // The menu's Quit still works while the dialog is up.
        if (win.isDestroyed() || win.webContents.isDestroyed()) return;
        if (response === 0) {
          deaths = [];
          win.webContents.reload();
        } else {
          app.quit();
        }
      });
  });
  win.webContents.on('unresponsive', () => {
    log('warn', 'renderer unresponsive');
  });
  win.webContents.on('responsive', () => {
    log('info', 'renderer responsive again');
  });
}

/**
 * The other process deaths (GPU, utility, …) and the power events a
 * blank window tends to be reported after. Log lines only: these
 * events are the only place the reasons are ever reported, and a blank
 * window with no line in the log has no cause. The power events give
 * that line a timeline.
 */
export function installProcessDiagnostics(): void {
  app.on('child-process-gone', (_event, details) => {
    const name = details.name ? ` ${details.name}` : '';
    log(
      'error',
      `${details.type} process gone: ${details.reason} (exit code ${details.exitCode})${name}`
    );
  });
  const power = (event: string) => () => log('info', `power: ${event}`);
  // Lock and unlock events exist on macOS and Windows only.
  powerMonitor.on('suspend', power('suspend'));
  powerMonitor.on('resume', power('resume'));
}
