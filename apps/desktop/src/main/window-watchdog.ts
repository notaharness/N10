/**
 * A window that comes back blank from suspend.
 *
 * The host is fine, the renderer process is usually alive, and Electron
 * reports nothing: no process died. What the user sees is the window's
 * background colour, and a restart. Two things produce that picture.
 * A renderer whose main thread is stuck cannot draw the frame the
 * compositor asks for once the display comes back, so the window shows
 * nothing; and a renderer that is alive but has stopped getting frames
 * onto the screen looks the same. Neither is an event, so after a
 * resume (or a GPU process death, which resets the compositor the same
 * way) the window is probed the next time the user is looking at it:
 * a script that never answers is a hung renderer, and a page capture
 * that never completes is a window producing no frames. Each step of
 * the recovery is logged, so a window that still stays blank at least
 * says what was tried.
 */
import { app, powerMonitor, type BrowserWindow } from 'electron';
import { log } from './log.js';

export type Probe = 'healthy' | 'hung' | 'unpainted';

export type RecoveryStep =
  | 'none'
  | 'crash'
  | 'repaint'
  | 'reload'
  | 'recreate'
  | 'give-up';

/** How long a probe may take before the renderer counts as not answering. */
export const PROBE_TIMEOUT_MS = 5_000;
/** The time given to the system after a resume before the first probe. */
export const RESUME_SETTLE_MS = 3_000;
/** How long each recovery step gets to take effect before the next probe. */
export const RECHECK_MS = 4_000;

/**
 * The recovery step for a probe result, given how many steps have been
 * taken since the window last probed healthy. A hung renderer is
 * crashed, which the crash handler answers with a reload. A window
 * that produces no frames is first asked to repaint, then reloaded,
 * then replaced by a fresh window (a new compositor surface); after
 * that the log is the only help left.
 */
export function recoveryStep(probe: Probe, attempt: number): RecoveryStep {
  if (probe === 'healthy') return 'none';
  if (probe === 'hung') return attempt < 3 ? 'crash' : 'give-up';
  const unpainted: RecoveryStep[] = ['repaint', 'reload', 'recreate'];
  return unpainted[attempt] ?? 'give-up';
}

const TIMED_OUT = Symbol('timed out');

function withTimeout<T>(
  promise: Promise<T>,
  ms: number
): Promise<T | typeof TIMED_OUT> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(TIMED_OUT), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(TIMED_OUT);
      }
    );
  });
}

/** Ask the renderer whether it runs scripts and produces frames. */
export async function probeWindow(win: BrowserWindow): Promise<Probe> {
  const contents = win.webContents;
  if (contents.isCrashed()) return 'hung';
  const answered = await withTimeout(
    contents.executeJavaScript('true', true),
    PROBE_TIMEOUT_MS
  );
  if (answered === TIMED_OUT) return 'hung';
  const painted = await withTimeout(contents.capturePage(), PROBE_TIMEOUT_MS);
  return painted === TIMED_OUT ? 'unpainted' : 'healthy';
}

export interface WatchdogHooks {
  /** Open a fresh window in place of this one; the old one is destroyed after. */
  recreate: () => void;
}

export function installWindowWatchdog(
  win: BrowserWindow,
  hooks: WatchdogHooks
): void {
  let suspect = false;
  let attempt = 0;
  let checking = false;
  let timer: NodeJS.Timeout | null = null;

  const gone = () => win.isDestroyed() || win.webContents.isDestroyed();
  const lookedAt = () => !gone() && win.isVisible() && !win.isMinimized();

  const later = (ms: number, requireFocus: boolean) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (requireFocus && (gone() || !win.isFocused())) return;
      void check();
    }, ms);
  };

  const act = (step: RecoveryStep): void => {
    switch (step) {
      case 'crash':
        // renderer-recovery.ts answers the death with a reload.
        win.webContents.forcefullyCrashRenderer();
        return;
      case 'repaint':
        win.webContents.invalidate();
        return;
      case 'reload':
        win.webContents.reload();
        return;
      case 'recreate':
        hooks.recreate();
        return;
      case 'give-up':
      case 'none':
        return;
    }
  };

  async function check(): Promise<void> {
    if (checking || !lookedAt()) return;
    checking = true;
    try {
      const probe = await probeWindow(win);
      if (gone()) return;
      const step = recoveryStep(probe, attempt);
      if (probe === 'healthy') {
        if (attempt > 0) log('info', 'window healthy again');
        suspect = false;
        attempt = 0;
        return;
      }
      log(
        'error',
        `window ${probe} after ${attempt === 0 ? 'resume' : `recovery step ${attempt}`}: ${step}`
      );
      attempt += 1;
      act(step);
      if (step !== 'give-up' && step !== 'recreate') later(RECHECK_MS, false);
    } finally {
      checking = false;
    }
  }

  const mark = (why: string) => {
    if (gone()) return;
    suspect = true;
    log('info', `window suspect after ${why}; probing when it is looked at`);
    later(RESUME_SETTLE_MS, true);
  };

  const onResume = () => mark('resume');
  const onChildGone = (
    _event: Electron.Event,
    details: Electron.Details
  ) => {
    if (details.type === 'GPU') mark('GPU process death');
  };
  powerMonitor.on('resume', onResume);
  app.on('child-process-gone', onChildGone);
  win.on('focus', () => {
    if (suspect) void check();
  });
  win.on('closed', () => {
    powerMonitor.off('resume', onResume);
    app.off('child-process-gone', onChildGone);
    if (timer) clearTimeout(timer);
  });
}
