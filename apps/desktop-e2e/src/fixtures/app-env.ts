import { join } from 'node:path';

/**
 * The environment the app under test is launched with: the developer's
 * own, minus everything that would leak their machine into the run,
 * plus the isolation the fixture owns.
 *
 * Split out of `desktop.ts` so the scrub list and the overrides sit
 * together — every entry here is a variable that silently changes what
 * the suite is testing when someone happens to export it.
 */
export function appEnv(opts: {
  homeDir: string;
  repoPath: string;
  startWithoutRepo: boolean | undefined;
  githubToken: string | undefined;
  /** PATH additions that install the fake `gh`. */
  ghEnv: Record<string, string>;
  /** Extra knobs a test asked for. Applied before the isolation below. */
  extra: Record<string, string> | undefined;
}): Record<string, string> {
  const env = { ...process.env, ...opts.extra } as Record<string, string>;
  // On a Wayland session Electron talks to the compositor through
  // WAYLAND_DISPLAY and ignores DISPLAY altogether — so xvfb hands it
  // a virtual X server it never looks at, and the window opens on the
  // developer's real desktop anyway. Dropping the variable (and
  // pinning ozone to x11) is what actually makes the run headless.
  delete env.WAYLAND_DISPLAY;
  // The app reads these as fallbacks when no editor is configured, so
  // inheriting whatever the developer happens to export makes the
  // "no editor" path pass here and fail on a colleague's machine (or
  // the reverse). Tests that want one set it through config.
  delete env.EDITOR;
  delete env.VISUAL;
  // `$TMUX` names a socket outright and wins over the TMUX_TMPDIR set
  // below, so launching from inside a tmux session would put the
  // app's sessions on the developer's own tmux server.
  delete env.TMUX;
  delete env.TMUX_PANE;
  // `$BEAM_CONFIG_DIR` names a beam directory outright and wins over
  // the XDG_CONFIG_HOME set below — so a developer who exports it (the
  // documented override, and exactly what someone working on the
  // machines feature sets) would run the whole suite against their real
  // identity, peer table and paired machines.
  delete env.BEAM_CONFIG_DIR;
  // The suite exists to drive the *built* app. This variable makes the
  // main process load the Vite dev server instead, and the desktop dev
  // orchestrator exports it into every shell it starts — so a run from
  // one of those terminals silently tests a different bundle, or, once
  // the dev server is gone, a blank window and 30s timeouts.
  delete env.N10_VITE_URL;

  return {
    ...env,
    // Isolates config.json, desktop-prefs.json, recents *and*
    // Electron's own userData dir (so the single-instance lock never
    // makes one test's launch quit against another's).
    HOME: opts.homeDir,
    XDG_CONFIG_HOME: join(opts.homeDir, '.config'),
    N10_START_DIR: opts.startWithoutRepo ? '' : opts.repoPath,
    N10_DESKTOP_VERSION: 'e2e',
    ...(opts.githubToken ? { GH_TOKEN: opts.githubToken } : {}),
    // The fake `gh` has to win the PATH lookup.
    ...opts.ghEnv,
    // Last, and not negotiable. A tmux server is identified by its
    // socket directory, and the default one is the developer's own —
    // holding their real work and every persisted agent session. A
    // server started there by the app under test keeps this temp HOME
    // for its whole life and hands it to every session it later spawns,
    // so one run poisons real sessions long after it ends. Nothing
    // below may override this key.
    TMUX_TMPDIR: opts.homeDir,
  };
}
