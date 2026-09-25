/**
 * A window that comes back blank from suspend, with no event to say
 * so (see docs/decisions.md, "Desktop window health"). After a resume
 * or a GPU process death the window is probed while the user is
 * looking at it, and the verdict logged: a script that never answers
 * is a hung renderer, a page capture that never completes is a window
 * producing no frames. Nothing is done about it here: a renderer that
 * is merely busy after a resume would be killed by a cure, so the log
 * is the deliverable, and View → Reload Window the cure.
 */
import { app, powerMonitor, type BrowserWindow } from 'electron';
import { log } from './log.js';

export type Probe = 'healthy' | 'hung' | 'unpainted';

/** A busy main thread (a large diff folding) answers late; a hung one never. */
const SCRIPT_TIMEOUT_MS = 15_000;
/** A window that paints at all captures in milliseconds. */
const CAPTURE_TIMEOUT_MS = 5_000;
/** The time given to the system after a resume before the probe. */
const RESUME_SETTLE_MS = 3_000;

/**
 * Which Ozone platform Chromium picked: the switch when given, else
 * the hint, `auto` resolving to Wayland when a Wayland socket is there.
 */
export function ozonePlatform(
  switchValue: string,
  hint: string | undefined,
  waylandDisplay: string | undefined
): string {
  if (switchValue) return switchValue;
  const chosen = hint || 'auto';
  if (chosen !== 'auto') return chosen;
  return `${waylandDisplay ? 'wayland' : 'x11'} (auto)`;
}

/** The display stack, for the log at startup and after a resume. */
export function environmentLine(): string {
  const platform = ozonePlatform(
    app.commandLine.getSwitchValue('ozone-platform'),
    process.env.ELECTRON_OZONE_PLATFORM_HINT,
    process.env.WAYLAND_DISPLAY
  );
  const features = Object.entries(app.getGPUFeatureStatus())
    .map(([name, status]) => `${name}=${status}`)
    .join(' ');
  return `session ${
    process.env.XDG_SESSION_TYPE ?? 'unknown'
  }, ozone ${platform}, gpu ${features}`;
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
  let suspect: string | null = null;
  let checking = false;
  let timer: NodeJS.Timeout | null = null;

  const gone = () => win.isDestroyed() || win.webContents.isDestroyed();
  // A capture stalls on a window the compositor is not drawing too, so
  // only a focused window is probed: the user is looking at it.
  const lookedAt = () =>
    !gone() && win.isVisible() && !win.isMinimized() && win.isFocused();

  async function check(): Promise<void> {
    if (checking || !suspect || !lookedAt()) return;
    checking = true;
    try {
      const probe = await probeWindow(win);
      if (probe === null || gone() || !suspect) return;
      log(
        probe === 'healthy' ? 'info' : 'error',
        `window ${probe} after ${suspect}`
      );
      suspect = null;
    } finally {
      checking = false;
    }
  }

  const mark = (why: string) => {
    if (gone()) return;
    suspect = why;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void check();
    }, RESUME_SETTLE_MS);
  };

  const onResume = () => {
    log('info', environmentLine());
    mark('resume');
  };
  const onChildGone = (_event: Electron.Event, details: Electron.Details) => {
    if (details.type === 'GPU') mark('GPU process death');
  };
  powerMonitor.on('resume', onResume);
  app.on('child-process-gone', onChildGone);
  win.on('focus', () => void check());
  win.on('closed', () => {
    powerMonitor.off('resume', onResume);
    app.off('child-process-gone', onChildGone);
    if (timer) clearTimeout(timer);
  });
}
