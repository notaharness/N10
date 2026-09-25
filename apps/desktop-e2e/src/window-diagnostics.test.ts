import type { ElectronApplication } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect, fakeAgent } from './fixtures/desktop.js';
import { shown, startStreamingAgent } from './setup/app.js';

/**
 * A blank window explains itself: what the renderer threw is in the
 * desktop log, a resume is followed by a probe whose verdict (healthy,
 * hung, producing no frames) is logged, and a load the dev server could
 * not answer is retried until it can.
 */

const readLog = (homeDir: string) =>
  readFile(
    join(homeDir, '.config', 'n10-dev', 'logs', 'desktop.log'),
    'utf8'
  ).catch(() => '');

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
      .toMatch(/\[ERROR\] desktop: renderer: .*n10-e2e-uncaught/);
    expect(await readLog(homeDir)).toMatch(
      /\[ERROR\] desktop: renderer: .*n10-e2e-rejected/
    );
    // Raised on purpose; the fixture must not fail the test for them.
    await expect.poll(() => pageErrors.length).toBe(2);
    pageErrors.splice(0);
  });

  test('a resume logs the display stack and a healthy verdict', async ({
    desktop,
  }) => {
    const { app, homeDir } = desktop;
    await resume(app);
    await expect
      .poll(() => readLog(homeDir), { timeout: 30_000 })
      .toMatch(/window healthy after resume/);
    expect(await readLog(homeDir)).toMatch(
      /session \S+, ozone \S+.*, gpu \S+=\S+/
    );
  });

  test('a renderer hung across a resume is logged and left alone', async ({
    desktop,
  }) => {
    const { page, app, homeDir } = desktop;
    await startStreamingAgent(page, 'agent-work');
    await hangRenderer(app);
    await resume(app);
    await expect
      .poll(() => readLog(homeDir), { timeout: 45_000 })
      .toMatch(/\[ERROR\] desktop: window hung after resume/);
    expect(await readLog(homeDir)).not.toMatch(/renderer gone/);
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].webContents.isCrashed()
      )
    ).toBe(false);
  });

  test('a window that produces no frames is logged', async ({ desktop }) => {
    const { app, homeDir } = desktop;
    await app.evaluate(({ BrowserWindow }) => {
      // A capture that never completes is what a window that gets no
      // frames onto the screen looks like from the main process.
      BrowserWindow.getAllWindows()[0].webContents.capturePage = () =>
        new Promise(() => undefined);
    });
    await resume(app);
    await expect
      .poll(() => readLog(homeDir), { timeout: 30_000 })
      .toMatch(/\[ERROR\] desktop: window unpainted after resume/);
  });

  test('a load that fails is retried with backoff until the server answers', async ({
    desktop,
  }) => {
    const { app, homeDir } = desktop;
    const server = createServer((_req, res) => {
      res.setHeader('content-type', 'text/html');
      res.end('<h1>n10-e2e-back</h1>');
    });
    try {
      // Listen once to be handed a free port, then give it back.
      const port = await new Promise<number>((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          const address = server.address();
          const found = typeof address === 'object' ? address?.port : 0;
          server.close(() => resolve(found ?? 0));
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
        .toMatch(/retrying in 2000 ms/);
      const log = await readLog(homeDir);
      expect(log).toMatch(/retrying in 1000 ms/);
      // Chromium's error page finishing is not the renderer loading.
      expect(log.match(/renderer loaded/g)).toHaveLength(1);

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
