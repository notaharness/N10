/**
 * A window that comes back blank from suspend, with no event to say
 * so (see docs/decisions.md, "Desktop window health"). After a resume
 * or a GPU process death the window is probed while the user is
 * looking at it: a script that never answers is a hung renderer, a
 * page capture that never completes is a window producing no frames.
 * Every step is logged.
 */
import { app, powerMonitor, type BrowserWindow } from 'electron';
import { log } from './log.js';

export type Probe = 'healthy' | 'hung' | 'unpainted';

export type RecoveryStep = 'none' | 'crash' | 'repaint' | 'reload' | 'give-up';

/** A busy main thread (a large diff folding) answers late; a hung one never. */
const SCRIPT_TIMEOUT_MS = 15_000;
/** A window that paints at all captures in milliseconds. */
const CAPTURE_TIMEOUT_MS = 5_000;
/** The time given to the system after a resume before the first probe. */
const RESUME_SETTLE_MS = 3_000;
/** How long each recovery step gets to take effect before the next probe. */
const RECHECK_MS = 4_000;

/**
 * The recovery step for a probe result, given how many steps have been
 * taken since the window last probed healthy. A hung renderer is
 * crashed, which the crash handler answers with a reload. A window
 * that produces no frames is asked to repaint, then reloaded; after
 * that the log is the only help left.
 */
export function recoveryStep(probe: Probe, attempt: number): RecoveryStep {
  if (probe === 'healthy') return 'none';
  if (probe === 'hung') return attempt < 3 ? 'crash' : 'give-up';
  const unpainted: RecoveryStep[] = ['repaint', 'reload'];
  return unpainted[attempt] ?? 'give-up';
}

const TIMED_OUT = Symbol('timed out');
const REJECTED = Symbol('rejected');

function withTimeout<T>(
  promise: Promise<T>,
  ms: number
): Promise<T | typeof TIMED_OUT | typeof REJECTED> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(TIMED_OUT), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(REJECTED);
      }
    );
  });
}

/**
 * Ask the renderer whether it runs scripts and produces frames. Only
 * a timeout is evidence; a rejection (the frame went away under the
 * probe, a reload committing) is no answer at all.
 */
async function probeWindow(win: BrowserWindow): Promise<Probe | null> {
  const contents = win.webContents;
  if (contents.isCrashed()) return 'hung';
  const answered = await withTimeout(
    contents.executeJavaScript('true', true),
    SCRIPT_TIMEOUT_MS
  );
  if (answered === REJECTED) return null;
  if (answered === TIMED_OUT) return 'hung';
  const painted = await withTimeout(contents.capturePage(), CAPTURE_TIMEOUT_MS);
  if (painted === REJECTED) return null;
  return painted === TIMED_OUT ? 'unpainted' : 'healthy';
}

export function installWindowWatchdog(win: BrowserWindow): void {
  let suspect = false;
  let attempt = 0;
  let checking = false;
  let timer: NodeJS.Timeout | null = null;

  const gone = () => win.isDestroyed() || win.webContents.isDestroyed();
  // A capture stalls on a window the compositor is not drawing too, so
  // only a focused window is probed: the user is looking at it.
  const lookedAt = () =>
    !gone() && win.isVisible() && !win.isMinimized() && win.isFocused();

  const later = (ms: number) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
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
      case 'give-up':
      case 'none':
        return;
    }
  };

  async function check(): Promise<void> {
    if (checking || !lookedAt()) return;
    // A script waits for the load to finish; a slow reload is not a hang.
    if (win.webContents.isLoading()) {
      later(RECHECK_MS);
      return;
    }
    checking = true;
    try {
      const probe = await probeWindow(win);
      if (probe === null || gone()) return;
      if (probe === 'healthy') {
        if (attempt > 0) log('info', 'window healthy again');
        suspect = false;
        attempt = 0;
        return;
      }
      const step = recoveryStep(probe, attempt);
      log(
        'error',
        `window ${probe} after ${
          attempt === 0 ? 'resume' : `recovery step ${attempt}`
        }: ${step}`
      );
      if (step === 'give-up') {
        suspect = false;
        attempt = 0;
        return;
      }
      attempt += 1;
      act(step);
      later(RECHECK_MS);
    } finally {
      checking = false;
    }
  }

  const mark = () => {
    if (gone()) return;
    suspect = true;
    later(RESUME_SETTLE_MS);
  };

  const onChildGone = (_event: Electron.Event, details: Electron.Details) => {
    if (details.type === 'GPU') mark();
  };
  powerMonitor.on('resume', mark);
  app.on('child-process-gone', onChildGone);
  win.on('focus', () => {
    if (suspect) void check();
  });
  win.on('closed', () => {
    powerMonitor.off('resume', mark);
    app.off('child-process-gone', onChildGone);
    if (timer) clearTimeout(timer);
  });
}
