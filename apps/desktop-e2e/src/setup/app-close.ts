import type { ChildProcess } from 'node:child_process';
import type { ElectronApplication } from '@playwright/test';

/**
 * Shutting the app down at the end of a test, without betting the whole
 * worker on it.
 *
 * `electronApp.close()` asks the main process to `app.quit()` and then
 * waits for the launched process's **`close`** event. Node emits that
 * only once the process is gone *and* every stdio pipe it was given has
 * reached EOF, and Playwright launches Electron with four pipes. Chromium
 * hands its own stdout and stderr to every helper process it starts, so
 * one helper that outlives the browser process holds those pipes open and
 * `close` never arrives — the process exited, the wait cannot end. There
 * is no timeout on that wait: Playwright hangs in fixture teardown until
 * the 90s test timeout kills the worker, which fails whichever test
 * happened to be last and re-runs the rest in a fresh worker. That is one
 * defect wearing a different test's name on every run.
 *
 * So the quit is bounded. If the app has not closed by then the process
 * group is reaped — Playwright starts Electron detached, so the group is
 * exactly this app and its helpers, and the tmux server is not in it
 * (it daemonizes into a session of its own, and the fixture's own home
 * teardown reaps its sessions afterwards).
 */

/** How long a quit may take before the process group is reaped. Normal
 *  shutdown is milliseconds; this is the pathological case only. */
const QUIT_TIMEOUT_MS = 20_000;
/** How long the reaped process then has to actually go away. */
const REAP_TIMEOUT_MS = 5_000;

function after(ms: number): Promise<'timeout'> {
  return new Promise((resolve) => {
    setTimeout(() => resolve('timeout'), ms).unref();
  });
}

/** SIGKILL the app's whole process group, so a Chromium helper still
 *  holding the launcher's stdio pipes goes with it. Falls back to the
 *  single process if the group is gone or was never ours. */
function reap(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
  }
}

/** The launched process, while Playwright still has one. `process()`
 *  reaches through the dispatcher, which is gone once the application has
 *  closed — a test that quit the app itself arrives here with nothing left
 *  to hold, and there is then nothing to reap either. */
function launchedProcess(app: ElectronApplication): ChildProcess | undefined {
  try {
    return app.process() as ChildProcess | undefined;
  } catch {
    return undefined;
  }
}

/**
 * Close the app. Resolves with `null` on a clean quit, or with a
 * description of what had to be done instead — the caller attaches that
 * to the test so a run that needed the fallback still says so.
 */
export async function closeDesktopApp(
  app: ElectronApplication
): Promise<string | null> {
  const child = launchedProcess(app);
  const closed = new Promise<'closed'>((resolve) => {
    child?.once('close', () => resolve('closed'));
  });
  // Both are the same signal seen from two sides, and either one alone
  // can be the one that arrives: `close` fires only for a process that
  // was still running when the listener went on, and Playwright's own
  // promise settles for an application it can no longer reach.
  const quit = app.close().then(
    () => 'closed' as const,
    () => 'closed' as const
  );

  if (
    !child ||
    (await Promise.race([closed, quit, after(QUIT_TIMEOUT_MS)])) === 'closed'
  ) {
    await quit;
    return null;
  }

  const alive = child.exitCode === null && child.signalCode === null;
  reap(child.pid);
  const reaped = await Promise.race([closed, after(REAP_TIMEOUT_MS)]);
  return (
    `The app did not close within ${QUIT_TIMEOUT_MS}ms. ` +
    `Electron process ${child.pid} was ${
      alive
        ? 'still running'
        : 'already gone, so a helper process held its stdio open'
    }; ` +
    `its process group was killed and the launcher ${
      reaped === 'closed' ? 'reported the close' : 'still reported nothing'
    }.`
  );
}
