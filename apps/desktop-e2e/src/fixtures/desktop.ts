import {
  test as base,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  cleanupTestRepo,
  createTestRepo,
  type TestRepoOptions,
} from '../setup/git-repo.js';
import {
  fakeGhProjectConfig,
  installFakeGh,
  type FakeGitHub,
} from '../setup/fake-gh.js';
import {
  addExternalWorktree,
  startExternalTmuxSession,
} from '../setup/external.js';
import { killFixtureSessions } from '../setup/tmux.js';
import {
  startSurvivingTerminal,
  type TerminalSeed,
} from '../setup/terminals.js';
import { seedPeerTable, type PeerSeed } from '../setup/beam-peer.js';

const HERE = dirname(fileURLToPath(import.meta.url));
/** apps/desktop — Electron resolves `main` from its package.json. */
const APP_DIR = resolve(HERE, '..', '..', '..', 'desktop');
const WORKSPACE_ROOT = resolve(APP_DIR, '..', '..');
const FAKE_AGENT = join(HERE, 'fake-agent.mjs');

/**
 * `aiCommand` that spawns the fake agent.
 *
 *   fakeAgent()                 → alive but idle (no output after the banner)
 *   fakeAgent({ stream: true }) → continuously producing output
 */
export function fakeAgent(
  opts: {
    stream?: boolean;
    intervalMs?: number;
    exitAfterMs?: number;
    /** Echo stdin back, for testing the input round trip. */
    echo?: boolean;
    /** Stop streaming after this long, but stay alive. */
    streamMs?: number;
    /** Print the seed prompt the launcher handed it, `seed:`-prefixed. */
    printSeed?: boolean;
    /** Print the PTY grid as `size:<cols>x<rows>`, and again on resize. */
    printSize?: boolean;
  } = {}
): string {
  const flags = [`--banner=n10-fake-agent-ready`];
  if (opts.stream) flags.push('--stream');
  if (opts.echo) flags.push('--echo');
  if (opts.printSeed) flags.push('--print-seed');
  if (opts.printSize) flags.push('--print-size');
  if (opts.streamMs != null) flags.push(`--stream-ms=${opts.streamMs}`);
  if (opts.intervalMs != null) flags.push(`--interval-ms=${opts.intervalMs}`);
  if (opts.exitAfterMs != null)
    flags.push(`--exit-after-ms=${opts.exitAfterMs}`);
  return ['node', FAKE_AGENT, ...flags].join(' ');
}

export interface DesktopOptions {
  /** Config layered over the fake agent in the isolated HOME. */
  n10Config?: Record<string, unknown>;
  /**
   * Per-project config (vendor, org, repo…), written to the cwd-hashed
   * path the config store reads it from. Needed for anything gated on a
   * configured provider — the settings page only lists a provider's
   * auth fields once one is selected.
   */
  projectConfig?: Record<string, unknown>;
  /** Written to $HOME/.n10/desktop-prefs.json before launch. */
  desktopPrefs?: Record<string, unknown>;
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
   * Agent-authored draft review comments, keyed by pull request id, as
   * `n10 util add-comment` would have left them.
   */
  drafts?: Record<number, unknown[]>;
  /**
   * Serve the app a pull request (and its review threads) from a fake
   * `gh` on PATH, with the matching project config written for it.
   * Lets the whole review workspace be driven offline; ignored when
   * `githubToken` is set, which is the real thing.
   */
  fakeGitHub?: FakeGitHub;
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
  /**
   * Paired-machine rows already in the peer table when the app starts —
   * written straight to the isolated HOME's `$BEAM_DIR/peers.json`
   * before launch, exactly as a real pairing would have left it (see
   * `setup/beam-peer.ts`). Covers the D6 states a live second machine
   * cannot honestly produce in this fixture (`unreachable`,
   * `no-endpoint`, `revoked`); pairing with a real `startPeerHost()` for
   * `reachable` happens live, inside the test.
   */
  beamPeers?: PeerSeed[];
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

/**
 * Write the isolated `$HOME` a test runs against: global config, the
 * per-project config (cwd-hashed, as the config store keys it), any
 * agent-authored drafts, desktop prefs, and — when a scenario is given
 * — the fake `gh`. Returns the environment additions the app needs.
 *
 * Split out of the fixture body because it is the part that grows: one
 * more thing to seed is one more branch, and the fixture itself is
 * about launching and tearing down the app.
 */
function seedHome(
  homeDir: string,
  repoPath: string,
  opts: Pick<
    DesktopOptions,
    | 'n10Config'
    | 'projectConfig'
    | 'desktopPrefs'
    | 'drafts'
    | 'fakeGitHub'
    | 'beamPeers'
  >
): Record<string, string> {
  const n10 = join(homeDir, '.n10');
  mkdirSync(n10, { recursive: true });
  // A terminal tab runs the developer's login shell in this home. zsh
  // greets a home with no rc file with its first-user wizard, which
  // swallows whatever a test types next; an empty one means "configured,
  // nothing to do" and the shell comes up at a prompt.
  writeFileSync(join(homeDir, '.zshrc'), '', 'utf8');
  writeFileSync(
    join(n10, 'config.json'),
    JSON.stringify(
      {
        aiCommand: fakeAgent(),
        ...opts.n10Config,
      },
      null,
      2
    ),
    'utf8'
  );

  const projectConfig =
    opts.projectConfig ??
    (opts.fakeGitHub ? fakeGhProjectConfig(opts.fakeGitHub) : undefined);
  if (projectConfig) {
    // Per-project config lives under a hash of the repo path — see
    // projectKey() in @n10/vcs-core's config store.
    const key = createHash('sha256')
      .update(repoPath)
      .digest('hex')
      .slice(0, 16);
    const dir = join(n10, 'projects', key);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'config.json'),
      JSON.stringify(projectConfig, null, 2),
      'utf8'
    );
  }

  for (const [prId, comments] of Object.entries(opts.drafts ?? {})) {
    // Same layout the review agent writes to: ~/.n10/reviews/pr-<id>.
    const dir = join(n10, 'reviews', `pr-${prId}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'comments.json'),
      JSON.stringify({ prId: Number(prId), comments }, null, 2),
      'utf8'
    );
  }

  if (opts.beamPeers) seedPeerTable(homeDir, opts.beamPeers);

  if (opts.desktopPrefs) {
    writeFileSync(
      join(n10, 'desktop-prefs.json'),
      JSON.stringify(opts.desktopPrefs, null, 2),
      'utf8'
    );
  }

  return opts.fakeGitHub ? installFakeGh(homeDir, opts.fakeGitHub) : {};
}

/** Start the agents and terminal tabs a test wants already running when
 *  the app comes up — agents in the test's repository, or in another one
 *  a test names; terminals wherever they say. */
function seedTmux(
  repoPath: string,
  homeDir: string,
  sessions: { branch: string; command: string; repo?: string }[] | undefined,
  terminals: Record<string, TerminalSeed> | undefined
): void {
  for (const { branch, command, repo = repoPath } of sessions ?? []) {
    startExternalTmuxSession({
      repoPath: repo,
      homeDir,
      branch,
      worktreePath: addExternalWorktree(repo, branch),
      command,
    });
  }
  for (const [name, t] of Object.entries(terminals ?? {})) {
    startSurvivingTerminal({ name, ...t, homeDir });
  }
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

    // On a Wayland session Electron talks to the compositor through
    // WAYLAND_DISPLAY and ignores DISPLAY altogether — so xvfb hands it
    // a virtual X server it never looks at, and the window opens on the
    // developer's real desktop anyway. Dropping the variable (and
    // pinning ozone to x11) is what actually makes the run headless.
    const parentEnv = { ...process.env, ...env };
    delete parentEnv.WAYLAND_DISPLAY;
    // The app reads these as fallbacks when no editor is configured, so
    // inheriting whatever the developer happens to export makes the
    // "no editor" path pass here and fail on a colleague's machine (or
    // the reverse). Tests that want one set it through config.
    delete parentEnv.EDITOR;
    delete parentEnv.VISUAL;
    // `$TMUX` names a socket outright and wins over the TMUX_TMPDIR set
    // below, so launching from inside a tmux session would put the
    // app's sessions on the developer's own tmux server.
    delete parentEnv.TMUX;
    delete parentEnv.TMUX_PANE;
    // The suite exists to drive the *built* app. This variable makes the
    // main process load the Vite dev server instead, and the desktop dev
    // orchestrator exports it into every shell it starts — so a run from
    // one of those terminals silently tests a different bundle, or, once
    // the dev server is gone, a blank window and 30s timeouts.
    delete parentEnv.N10_VITE_URL;

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
      env: {
        ...parentEnv,
        // Isolates config.json, desktop-prefs.json, recents *and*
        // Electron's own userData dir (so the single-instance lock
        // never makes one test's launch quit against another's).
        HOME: homeDir,
        XDG_CONFIG_HOME: join(homeDir, '.config'),
        N10_START_DIR: startWithoutRepo ? '' : repoPath,
        N10_DESKTOP_VERSION: 'e2e',
        ...(githubToken ? { GH_TOKEN: githubToken } : {}),
        // The fake `gh` has to win the PATH lookup.
        ...ghEnv,
        // Last, and not negotiable. A tmux server is identified by its
        // socket directory, and the default one is the developer's own
        // — holding their real work and every persisted agent session.
        // A server started there by the app under test keeps this temp
        // HOME for its whole life and hands it to every session it
        // later spawns, so one run poisons real sessions long after it
        // ends. Nothing below may override this key.
        TMUX_TMPDIR: homeDir,
      },
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
