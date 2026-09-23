import type { ElectronApplication, Page } from '@playwright/test';
import { test, expect, fakeAgent } from './fixtures/desktop.js';
import {
  createWorktree,
  launchAgentFromRail,
  visibleText,
} from './setup/app.js';

const BRANCH = 'agent-work';

/**
 * A dead renderer leaves the BrowserWindow open and blank unless main
 * reloads it (main/renderer-recovery.ts). Proves the reload, that the
 * reloaded page picks its terminal back up from the host, and that a
 * window left dead on purpose is not fed output.
 *
 * Playwright's page handle belongs to the renderer that died and
 * answers "Target crashed" from the first crash on, so everything
 * after it goes through the main process.
 */

interface Counted {
  __n10Deaths?: number;
}

/** Count renderer deaths in the main process, where the event lands
 *  whether or not the window is reloaded straight away. */
function countDeaths(app: ElectronApplication): Promise<void> {
  return app.evaluate(({ BrowserWindow }) => {
    (globalThis as Counted).__n10Deaths = 0;
    BrowserWindow.getAllWindows()[0]?.webContents.on(
      'render-process-gone',
      () => {
        (globalThis as Counted).__n10Deaths! += 1;
      }
    );
  });
}

function deaths(app: ElectronApplication): Promise<number> {
  return app.evaluate(() => (globalThis as Counted).__n10Deaths ?? 0);
}

/** Kill the renderer the way the OS does, and wait for the death to
 *  register: a script sent to a renderer that is going down never
 *  answers. `forcefullyCrashRenderer` asks the renderer to crash
 *  itself on its main thread, which a starved CI runner can hold off
 *  for longer than a test waits; a signal is immediate. */
async function crash(app: ElectronApplication): Promise<void> {
  const before = await deaths(app);
  await app.evaluate(({ BrowserWindow }) => {
    const pid = BrowserWindow.getAllWindows()[0]?.webContents.getOSProcessId();
    if (pid) process.kill(pid, 'SIGKILL');
  });
  await expect
    .poll(() => deaths(app), { timeout: 15_000 })
    .toBeGreaterThan(before);
}

/** The window's text, as a user sees it: `innerText` leaves out the
 *  hidden panes. Empty while the renderer is dead. */
function shown(app: ElectronApplication): Promise<string> {
  return app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win || win.webContents.isCrashed()) return '';
    return win.webContents.executeJavaScript(
      'document.body.innerText'
    ) as Promise<string>;
  });
}

/** The fake agent's own line counter, as far as the window shows it. */
async function counter(app: ElectronApplication): Promise<number> {
  const matches = [...(await shown(app)).matchAll(/working (\d+)/g)];
  return Number(matches.at(-1)?.[1] ?? '0');
}

async function startStreamingAgent(
  page: Page,
  app: ElectronApplication
): Promise<void> {
  await createWorktree(page, BRANCH);
  await launchAgentFromRail(page);
  await expect(visibleText(page, 'n10-fake-agent-ready')).toBeVisible({
    timeout: 30_000,
  });
  await countDeaths(app);
}

test.describe('Renderer crash recovery', () => {
  test.use({ n10Config: { aiCommand: fakeAgent({ stream: true }) } });

  test('a crashed renderer is reloaded and its terminal resumes', async ({
    desktop,
  }) => {
    const { page, app } = desktop;
    await startStreamingAgent(page, app);

    await crash(app);
    await expect
      .poll(() => shown(app), { timeout: 30_000 })
      .toContain('WORKTREES');
    const before = await counter(app);
    await expect
      .poll(() => counter(app), { timeout: 15_000 })
      .toBeGreaterThan(before);
  });

  test('a renderer that keeps dying is asked about, and not fed output meanwhile', async ({
    desktop,
  }) => {
    const { page, app } = desktop;
    await startStreamingAgent(page, app);

    // The native question is replaced by one this test answers.
    await app.evaluate(({ dialog }) => {
      const g = globalThis as { __n10Answer?: (response: number) => void };
      (dialog as { showMessageBox: unknown }).showMessageBox = () =>
        new Promise((resolve) => {
          g.__n10Answer = (response: number) =>
            resolve({ response, checkboxChecked: false });
        });
    });
    const stderr: string[] = [];
    app.process().stderr?.on('data', (chunk: Buffer) => {
      stderr.push(String(chunk));
    });
    const deadFrameSends = () =>
      stderr.join('').split('Render frame was disposed').length - 1;
    const asked = () => app.evaluate(() => '__n10Answer' in globalThis);

    // Three deaths inside a minute are reloaded; the fourth is asked about.
    for (let i = 0; i < 3; i += 1) {
      await crash(app);
      await expect
        .poll(() => shown(app), { timeout: 30_000 })
        .toContain('WORKTREES');
    }
    await crash(app);
    await expect.poll(asked, { timeout: 15_000 }).toBe(true);

    // The window stays dead while the question is open and the agent
    // keeps streaming (a line every 150 ms); none of it may be sent to
    // the dead frame. Real time has to pass for that to be provable.
    const before = deadFrameSends();
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    expect(deadFrameSends()).toBe(before);

    // Reload, and the window is back with live output.
    await app.evaluate(() => {
      (
        globalThis as { __n10Answer?: (response: number) => void }
      ).__n10Answer?.(0);
    });
    await expect
      .poll(() => shown(app), { timeout: 30_000 })
      .toContain('WORKTREES');
    const after = await counter(app);
    await expect
      .poll(() => counter(app), { timeout: 15_000 })
      .toBeGreaterThan(after);
  });
});
