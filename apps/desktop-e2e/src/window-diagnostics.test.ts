import type { ElectronApplication, Page } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect, fakeAgent } from './fixtures/desktop.js';
import {
  createWorktree,
  launchAgentFromRail,
  visibleText,
} from './setup/app.js';

/**
 * A blank window explains itself: what the renderer threw is in the
 * desktop log, a renderer that stops answering after a resume is
 * replaced, a window that produces no frames gets a new one, and a
 * load the dev server could not answer is retried until it can.
 */

const logPath = (homeDir: string) =>
  join(homeDir, '.config', 'n10-dev', 'logs', 'desktop.log');

const readLog = (homeDir: string) =>
  readFile(logPath(homeDir), 'utf8').catch(() => '');

/** The window's text as the main process sees it; empty while dead. */
function shown(app: ElectronApplication): Promise<string> {
  return app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win || win.webContents.isCrashed()) return '';
    return Promise.race([
      win.webContents.executeJavaScript(
        'document.body.innerText'
      ) as Promise<string>,
      new Promise<string>((resolve) => setTimeout(() => resolve(''), 3_000)),
    ]);
  });
}

async function counter(app: ElectronApplication): Promise<number> {
  const matches = [...(await shown(app)).matchAll(/working (\d+)/g)];
  return Number(matches.at(-1)?.[1] ?? '0');
}

async function startStreamingAgent(page: Page): Promise<void> {
  await createWorktree(page, 'agent-work');
  await launchAgentFromRail(page);
  await expect(visibleText(page, 'n10-fake-agent-ready')).toBeVisible({
    timeout: 30_000,
  });
}

/** Stop the renderer's main thread for good. */
function hangRenderer(app: ElectronApplication): Promise<void> {
  return app.evaluate(({ BrowserWindow }) => {
    void BrowserWindow.getAllWindows()[0]
      ?.webContents.executeJavaScript('for (;;) {}')
      .catch(() => undefined);
  });
}

const resume = (app: ElectronApplication) =>
  app.evaluate(({ powerMonitor }) => {
    powerMonitor.emit('resume');
  });

test.describe('Window diagnostics', () => {
  test.use({ n10Config: { aiCommand: fakeAgent({ stream: true }) } });

  test('renderer exceptions and rejections reach the desktop log', async ({
    desktop,
  }) => {
    const { page, homeDir, pageErrors } = desktop;
    await page.evaluate(() => {
      setTimeout(() => {
        throw new Error('n10-e2e-uncaught');
      }, 0);
      void Promise.reject(new Error('n10-e2e-rejected'));
    });
    await expect
      .poll(() => readLog(homeDir), { timeout: 10_000 })
      .toMatch(/error renderer: .*n10-e2e-uncaught/);
    expect(await readLog(homeDir)).toMatch(
      /error renderer: .*n10-e2e-rejected/
    );
    // Raised on purpose; the fixture must not fail the test for them.
    pageErrors.splice(0);
  });

  test('a renderer hung across a resume is replaced and its terminal resumes', async ({
    desktop,
  }) => {
    const { page, app, homeDir } = desktop;
    await startStreamingAgent(page);
    await hangRenderer(app);
    await resume(app);
    await expect
      .poll(() => readLog(homeDir), { timeout: 30_000 })
      .toMatch(/window hung after resume: crash/);
    await expect
      .poll(() => shown(app), { timeout: 30_000 })
      .toContain('WORKTREES');
    const before = await counter(app);
    await expect
      .poll(() => counter(app), { timeout: 15_000 })
      .toBeGreaterThan(before);
  });

  test('a window that produces no frames is repainted, reloaded, then replaced', async ({
    desktop,
  }) => {
    const { page, app, homeDir } = desktop;
    await startStreamingAgent(page);
    const first = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      // The capture never completes: what a window that gets no frames
      // onto the screen looks like from the main process. The stub
      // lives on this webContents, so only a new window escapes it.
      win.webContents.capturePage = () => new Promise(() => undefined);
      return win.id;
    });
    await resume(app);
    await expect
      .poll(() => readLog(homeDir), { timeout: 60_000 })
      .toMatch(/window unpainted after recovery step 2: recreate/);
    await expect
      .poll(
        () =>
          app.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows().map((w) => w.id)
          ),
        { timeout: 15_000 }
      )
      .not.toContain(first);
    await expect
      .poll(() => shown(app), { timeout: 30_000 })
      .toContain('WORKTREES');
    const log = await readLog(homeDir);
    expect(log).toMatch(/window unpainted after resume: repaint/);
    expect(log).toMatch(/window unpainted after recovery step 1: reload/);
  });

  test('a load that fails is retried until the server answers', async ({
    desktop,
  }) => {
    const { app, homeDir } = desktop;
    const server = createServer((_req, res) => {
      res.setHeader('content-type', 'text/html');
      res.end('<h1>n10-e2e-back</h1>');
    });
    try {
      const port = await new Promise<number>((resolve) => {
        const probe = createServer();
        probe.listen(0, '127.0.0.1', () => {
          const address = probe.address();
          const found = typeof address === 'object' ? address?.port : 0;
          probe.close(() => resolve(found ?? 0));
        });
      });
      const url = `http://127.0.0.1:${port}/`;
      await app.evaluate(({ BrowserWindow }, url) => {
        void BrowserWindow.getAllWindows()[0]
          ?.webContents.loadURL(url)
          .catch(() => undefined);
      }, url);
      await expect
        .poll(() => readLog(homeDir), { timeout: 15_000 })
        .toMatch(/error load of http:\/\/127\.0\.0\.1:\d+\/ failed/);

      await new Promise<void>((resolve) =>
        server.listen(port, '127.0.0.1', resolve)
      );
      await expect
        .poll(() => shown(app), { timeout: 30_000 })
        .toContain('n10-e2e-back');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
