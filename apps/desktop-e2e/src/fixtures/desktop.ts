import {
  test as base,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  cleanupTestRepo,
  createTestRepo,
  type TestRepoOptions,
} from '../setup/git-repo.js';
import { killFixtureSessions } from '../setup/tmux.js';
import { appEnv } from './app-env.js';
import type { TerminalSeed } from '../setup/terminals.js';
import { fakeAgent, seedHome, seedTmux, type HomeSeed } from './seed-home.js';

const HERE = dirname(fileURLToPath(import.meta.url));
/** apps/desktop — Electron resolves `main` from its package.json. */
const APP_DIR = resolve(HERE, '..', '..', '..', 'desktop');
const WORKSPACE_ROOT = resolve(APP_DIR, '..', '..');

export { fakeAgent };

export interface DesktopOptions extends HomeSeed {
  /** Seed options for the per-test git repo. */
  repo?: TestRepoOptions;
  /**
   * Start with no repo open (the repo picker screen) instead of
   * pointing N10_START_DIR at the test repo.
   */
  startWithoutRepo?: boolean;
  /**
   * Open this path instead of a freshly created throwaway repo. The
   * caller owns its lifecycle — used by the integration tests, which
   * clone the shared sandbox repo once per file.
   */
  repoPathOverride?: string;
  /**
   * Hand the app a GitHub token. Its HOME is isolated, so the `gh` CLI
   * it authenticates through cannot see the developer's stored
   * credentials; without this it behaves as a repo with no provider.
   */
  githubToken?: string;
  /**
   * Agent sessions already running when the app starts — the state
   * after a previous run whose agents were left in tmux. Each is a
   * worktree added with plain git plus a tmux session under the name
   * n10 uses, on the test's own socket. Data rather than a callback: Playwright
   * reads a function-valued option as a fixture definition. `repo`
   * puts the agent in another repository than the test's own — the
   * state after a run that had work open across several.
   */
  liveSessions?: { branch: string; command: string; repo?: string }[];
  /**
   * Extra environment for the app process, for the knobs the host
   * reads from it — a background cadence a test cannot wait out at its
   * real value. Cannot override the isolation the fixture sets up
   * (HOME, the tmux socket, the fake `gh`), which is applied after.
   */
  env?: Record<string, string>;
  /**
   * Terminal tabs already running when the app starts — the state after
   * a previous run that opened them was quit, since quitting only
   * detaches. Each is a tmux session tagged as a terminal tab of the
   * given kind (shell unless said), in the given directory, on the
   * test's own socket.
   *
   * Keyed by session name rather than listed: Playwright reads any
   * array whose second element is an object as a `[value, options]`
   * fixture tuple, so a two-entry list arrives as its first entry.
   */
  liveTerminals?: Record<string, TerminalSeed>;
}

export interface DesktopApp {
  app: ElectronApplication;
  page: Page;
  repoPath: string;
  homeDir: string;
  /** Renderer errors seen so far — the fixture fails the test on any. */
  pageErrors: string[];
  /** Evaluate in the main process (e.g. to inspect host services). */
  main: ElectronApplication['evaluate'];
}

export const test = base.extend<
  DesktopOptions & { desktop: DesktopApp; fixtureHome: string }
>({
  // eslint-disable-next-line no-empty-pattern -- Playwright requires a destructured fixture dependency parameter.
  fixtureHome: async ({}, provide) => {
    const homeDir = mkdtempSync(join(tmpdir(), 'n10-desktop-e2e-home-'));
    try {
      await provide(homeDir);
    } finally {
      killFixtureSessions(homeDir);
      await rm(homeDir, { recursive: true, force: true });
    }
  },
  n10Config: [undefined, { option: true }],
  projectConfig: [undefined, { option: true }],
  desktopPrefs: [undefined, { option: true }],
  repo: [undefined, { option: true }],
  startWithoutRepo: [false, { option: true }],
  repoPathOverride: [undefined, { option: true }],
  githubToken: [undefined, { option: true }],
  drafts: [undefined, { option: true }],
  fakeGitHub: [undefined, { option: true }],
  liveSessions: [undefined, { option: true }],
  env: [undefined, { option: true }],
  liveTerminals: [undefined, { option: true }],
  beamPeers: [undefined, { option: true }],

  desktop: async (
    {
      n10Config,
      projectConfig,
      desktopPrefs,
      repo,
      startWithoutRepo,
      repoPathOverride,
      githubToken,
      drafts,
      fakeGitHub,
      liveSessions,
      env,
      liveTerminals,
      beamPeers,
      fixtureHome,
    },
    // Playwright's fixture callback. Named `provide` rather than the
    // conventional `use` so it does not read as a React hook call to
    // the react-hooks rules, which run over this workspace.
    provide,
    testInfo
  ) => {
    const ownsRepo = !repoPathOverride;
    const repoPath = repoPathOverride ?? createTestRepo(repo ?? {});
    const homeDir = fixtureHome;
    const ghEnv = seedHome(homeDir, repoPath, {
      n10Config,
      projectConfig,
      desktopPrefs,
      drafts,
      fakeGitHub,
      beamPeers,
    });

    seedTmux(repoPath, homeDir, liveSessions, liveTerminals);

    const app = await electron.launch({
      args: [
        APP_DIR,
        // CI runners have no user namespaces for the sandbox, and
        // software rendering is both available and deterministic.
        '--no-sandbox',
        '--disable-gpu',
        '--ozone-platform=x11',
      ],
      cwd: WORKSPACE_ROOT,
      env: appEnv({
        homeDir,
        repoPath,
        startWithoutRepo,
        githubToken,
        ghEnv,
        extra: env,
      }),
      timeout: 60_000,
    });

    const page = await app.firstWindow();

    // Chromium throttles requestAnimationFrame in a window it considers
    // hidden or occluded, and under xvfb (or behind another window on a
    // developer's desktop) that is the normal state. Playwright's
    // actionability check waits for two consecutive stable animation
    // frames before it will click, so a throttled window makes every
    // click hang until the timeout even though the page is perfectly
    // idle. Show, focus and un-throttle before any test touches it.
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (!win) return;
      win.webContents.setBackgroundThrottling(false);
      win.show();
      win.focus();
    });

    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on('pageerror', (err) =>
      pageErrors.push(err.stack || err.message || String(err))
    );
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.waitForLoadState('domcontentloaded');
    if (!startWithoutRepo) {
      // The workspace has rendered (not the repo picker, not a blank
      // window) once the sidebar's actions exist.
      await page
        .getByRole('button', { name: 'New worktree', exact: true })
        .first()
        .waitFor({ state: 'visible', timeout: 30_000 });
    }

    let used = false;
    try {
      await provide({
        app,
        page,
        repoPath,
        homeDir,
        pageErrors,
        main: app.evaluate.bind(app),
      });
      used = true;
    } finally {
      if (consoleErrors.length) {
        await testInfo.attach('renderer-console-errors', {
          body: consoleErrors.join('\n'),
          contentType: 'text/plain',
        });
      }
      try {
        await app.close();
      } catch {
        /* already gone */
      }
      if (ownsRepo) cleanupTestRepo(repoPath);
    }

    // An uncaught renderer exception blanks a pane behind the
    // ErrorBoundary, which a passing assertion elsewhere would happily
    // ignore. Surface it as a failure of the test that provoked it —
    // but only when the test itself got that far, so a real assertion
    // failure keeps priority.
    if (used && pageErrors.length > 0) {
      throw new Error(
        `Renderer threw during the test:\n${pageErrors.join('\n---\n')}`
      );
    }
  },
});

export { expect };
