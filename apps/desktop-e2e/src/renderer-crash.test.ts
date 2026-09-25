import type { ElectronApplication, Page } from '@playwright/test';
import { test, expect, fakeAgent } from './fixtures/desktop.js';
import { agentCounter, shown, startStreamingAgent } from './setup/app.js';

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

async function armed(page: Page, app: ElectronApplication): Promise<void> {
  await startStreamingAgent(page, BRANCH);
  await countDeaths(app);
}

test.describe('Renderer crash recovery', () => {
  test.use({ n10Config: { aiCommand: fakeAgent({ stream: true }) } });

  test('a crashed renderer is reloaded and its terminal resumes', async ({
    desktop,
  }) => {
    const { page, app } = desktop;
    await armed(page, app);

    await crash(app);
    await expect
      .poll(() => shown(app), { timeout: 30_000 })
      .toContain('WORKTREES');
    const before = await agentCounter(app);
    await expect
      .poll(() => agentCounter(app), { timeout: 15_000 })
      .toBeGreaterThan(before);
  });

  test('a renderer that keeps dying is asked about, and not fed output meanwhile', async ({
    desktop,
  }) => {
    const { page, app } = desktop;
    await armed(page, app);

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
    const after = await agentCounter(app);
    await expect
      .poll(() => agentCounter(app), { timeout: 15_000 })
      .toBeGreaterThan(after);
  });
});
