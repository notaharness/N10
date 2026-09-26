import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

/**
 * Helpers for asserting on the tmux sessions n10 creates.
 *
 * Every call takes the test's `n10.homeDir`, because the fixture spawns
 * n10 with `TMUX_TMPDIR=<homeDir>` — each test's tmux server therefore
 * listens on a socket inside its own temp home, not the shared
 * /tmp/tmux-$UID one. A helper that omitted it would query a different
 * (usually empty) server and report every session as missing.
 *
 * A session's name is a label (`<repo>-<branch>`, with a numeric suffix
 * on collision) and is never parsed. What makes a session n10's is
 * its tags — `@orchestra-spawner`, `@orchestra-session-type`,
 * `@orchestra-repo`, `@orchestra-branch` — so every helper here lists
 * with the tags and matches on them, exactly as the app does.
 */

/** Prefix for branches created by tmux e2e tests. Cleanup only ever
 *  touches sessions matching this, so a developer's real n10 tmux
 *  sessions can't be caught in the blast radius. */
const E2E_BRANCH_PREFIX = 'e2e-tmux-';

/** Basename prefix of the temp homes the fixture creates. The tmux
 *  socket lives inside one, and `socketEnv` refuses any other dir. */
const HOME_PREFIX = 'n10-e2e-web-home-';

export function tmuxAvailable(): boolean {
  try {
    execFileSync('tmux', ['-V'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Unique, short, git-legal branch name carrying the e2e marker. */
export function uniqueTmuxBranch(): string {
  return `${E2E_BRANCH_PREFIX}${randomBytes(3).toString('hex')}`;
}

/** The socket dir a tmux helper is about to use, proven to be one of
 *  this run's throwaway homes.
 *
 *  Two things decide which tmux server a command reaches, and checking
 *  only the first is the trap that makes this worth asserting:
 *
 *    - `TMUX_TMPDIR` picks the directory the socket lives in. Its
 *      default is the OS temp dir, i.e. the developer's own
 *      `/tmp/tmux-$UID/default`.
 *    - `TMUX` names a socket path outright and **wins**. A suite
 *      started from inside a tmux session — which is how n10's own
 *      agents run — reaches the developer's server no matter what
 *      `TMUX_TMPDIR` says.
 *
 *  These helpers kill sessions, and on that server the tagged sessions
 *  are the user's running agents. So the socket is proven rather than
 *  assumed, and anything unproven throws.
 */
function socketEnv(tmuxTmpdir: string): NodeJS.ProcessEnv {
  if (!tmuxTmpdir) {
    throw new Error('tmux helpers need the test homeDir (TMUX_TMPDIR)');
  }
  if (resolve(tmuxTmpdir) === resolve(tmpdir())) {
    throw new Error(
      `refusing to use the default tmux socket dir (${tmuxTmpdir}) — ` +
        "that is the developer's own tmux server"
    );
  }
  if (!basename(tmuxTmpdir).startsWith(HOME_PREFIX)) {
    throw new Error(
      `${tmuxTmpdir} is not a ${HOME_PREFIX}* temp home created by the fixture`
    );
  }
  const env: NodeJS.ProcessEnv = { ...process.env, TMUX_TMPDIR: tmuxTmpdir };
  // Removed, not overridden: while it is set tmux ignores TMUX_TMPDIR.
  delete env.TMUX;
  delete env.TMUX_PANE;
  return env;
}

/** One session on the test's server, with the tags that identify it.
 *  Unset tags are `''`. */
export interface TaggedTmuxSession {
  name: string;
  spawner: string;
  type: string;
  repo: string;
  branch: string;
  paneDead: boolean;
  panePid: number;
}

const LISTING = [
  '#{session_name}',
  '#{@orchestra-spawner}',
  '#{@orchestra-session-type}',
  '#{@orchestra-repo}',
  '#{@orchestra-branch}',
  '#{pane_dead}',
  '#{pane_pid}',
].join('\t');

/** Every session on the test's tmux server, tags included. Empty when
 *  no server is running — tmux exits non-zero for that, which is not an
 *  error here. */
export function listTaggedSessions(tmuxTmpdir: string): TaggedTmuxSession[] {
  // Resolved *before* the try: `socketEnv` throws to stop a run that
  // would reach the wrong tmux server, and swallowing that here would
  // turn it into an empty list — which is exactly what the negative
  // assertions ("no n10 session exists") expect, so they would pass
  // while proving nothing, and teardown would silently reap nothing.
  const env = socketEnv(tmuxTmpdir);
  try {
    return execFileSync('tmux', ['-u', 'list-sessions', '-F', LISTING], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      env,
    })
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => {
        const [
          name = '',
          spawner = '',
          type = '',
          repo = '',
          branch = '',
          dead,
          pid,
        ] = line.split('\t');
        return {
          name,
          spawner,
          type,
          repo,
          branch,
          paneDead: dead === '1',
          panePid: Number(pid),
        };
      });
  } catch {
    return [];
  }
}

/** Session names on the test's tmux server. */
export function listTmuxSessions(tmuxTmpdir: string): string[] {
  return listTaggedSessions(tmuxTmpdir).map((s) => s.name);
}

/** Names of the sessions on the test's server that carry n10's
 *  identity tags — whatever they are called. */
export function n10Sessions(tmuxTmpdir: string): string[] {
  return listTaggedSessions(tmuxTmpdir)
    .filter((s) => s.spawner && s.type)
    .map((s) => s.name);
}

/** The tagged worktree session for `branch`, if it exists. */
export function findN10SessionFor(
  branch: string,
  tmuxTmpdir: string
): string | undefined {
  return listTaggedSessions(tmuxTmpdir).find(
    (s) => s.spawner && s.type === 'worktree' && s.branch === branch
  )?.name;
}

export function n10SessionExists(branch: string, tmuxTmpdir: string): boolean {
  return findN10SessionFor(branch, tmuxTmpdir) !== undefined;
}

/**
 * Teardown for tmux-backed tests. `killAll()` on n10 exit deliberately
 * only *detaches*, so every tmux-backed test would otherwise leave a live
 * session (holding a fake-agent process) behind.
 *
 * Refuses any branch without the e2e marker — a guard against a future
 * caller passing something broader and wiping real sessions.
 */
export function cleanupTmuxSessions(
  branches: string[],
  tmuxTmpdir: string
): void {
  const env = socketEnv(tmuxTmpdir);
  for (const branch of branches) {
    if (!branch.startsWith(E2E_BRANCH_PREFIX)) {
      throw new Error(
        `refusing to clean up tmux sessions for non-e2e branch "${branch}"`
      );
    }
    const name = findN10SessionFor(branch, tmuxTmpdir);
    if (!name) continue;
    try {
      execFileSync('tmux', ['kill-session', '-t', `=${name}:`], {
        stdio: 'ignore',
        env,
      });
    } catch {
      /* already gone — best effort */
    }
  }
}

/** Clean up every session on the proven, per-test socket before its HOME
 * is deleted. Untagged sessions can exist after an interrupted launch. */
export function killFixtureSessions(homeDir: string): void {
  const env = socketEnv(homeDir);
  for (const name of listTmuxSessions(homeDir)) {
    try {
      execFileSync('tmux', ['kill-session', '-t', `=${name}:`], {
        stdio: 'ignore',
        env,
      });
    } catch {
      // Another teardown may already have stopped it.
    }
  }
}

// ── Sessions created without n10 ───────────────────────────────
//
// The other direction from the helpers above: instead of asserting on
// what n10 made, these *make* the thing n10 is supposed to notice —
// a worktree and a tmux session created the way a second n10, a
// script or an operator at a shell would create them: any name, and
// the identity tags.

/** The main checkout as n10 records it in `@orchestra-repo`: the
 *  symlink-resolved git toplevel, not the fixture's `repoPath`, which
 *  can differ when tmpdir is a symlink (macOS /tmp → /private/tmp). */
function repoRootOf(repoPath: string): string {
  return realpathSync(
    execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: repoPath,
      encoding: 'utf8',
    }).trim()
  );
}

/** The label n10 would choose — `<repo>-<branch>` with `/`, `.` and
 *  `:` rewritten. Any name would do; this one keeps `tmux ls` readable. */
export function n10TmuxLabel(repoPath: string, branch: string): string {
  return `${basename(repoRootOf(repoPath))}-${branch}`.replace(/[/.:]/g, '-');
}

/**
 * Add a worktree under the directory n10's default resolver owns,
 * with plain git and no help from n10. Returns its absolute path.
 */
export function addExternalWorktree(repoPath: string, branch: string): string {
  const path = join(repoPath, '.claude', 'worktrees', branch);
  execFileSync('git', ['worktree', 'add', '-b', branch, path], {
    cwd: repoPath,
    stdio: 'ignore',
  });
  return path;
}

/**
 * Start a detached tmux session tagged the way n10 tags a worktree
 * session, on the test's own tmux server. Returns its name.
 *
 * `HOME` and `PATH` are pinned per session for the reason the backend
 * pins them: a tmux server keeps the environment it was started with
 * and spawns every session command with it, so whichever process
 * happened to start the server would otherwise decide what the agent
 * sees.
 */
export function startExternalTmuxSession(opts: {
  repoPath: string;
  homeDir: string;
  branch: string;
  worktreePath: string;
  command: string;
}): string {
  const name = n10TmuxLabel(opts.repoPath, opts.branch);
  const env = socketEnv(opts.homeDir);
  execFileSync(
    'tmux',
    [
      'new-session',
      '-d',
      '-s',
      name,
      '-c',
      opts.worktreePath,
      '-x',
      '120',
      '-y',
      '40',
      '-e',
      `HOME=${opts.homeDir}`,
      '-e',
      `PATH=${process.env.PATH ?? ''}`,
      '--',
      '/bin/sh',
      '-c',
      opts.command,
    ],
    { stdio: 'ignore', env }
  );
  const tags: Record<string, string> = {
    '@orchestra-spawner': 'n10',
    '@orchestra-repo': repoRootOf(opts.repoPath),
    '@orchestra-session-type': 'worktree',
    '@orchestra-branch': opts.branch,
    '@orchestra-worktree-path': realpathSync(opts.worktreePath),
  };
  for (const [key, value] of Object.entries(tags)) {
    execFileSync('tmux', ['set-option', '-t', `=${name}:`, key, value], {
      stdio: 'ignore',
      env,
    });
  }
  return name;
}

/** Failure diagnostics from the private server before fixture teardown. */
export function fixtureSessionScreens(homeDir: string): unknown[] {
  const env = socketEnv(homeDir);
  return listTaggedSessions(homeDir).map((session) => {
    try {
      const screen = execFileSync(
        'tmux',
        ['capture-pane', '-p', '-t', `=${session.name}:`],
        {
          env,
          encoding: 'utf8',
        }
      );
      return { ...session, screen };
    } catch {
      return session;
    }
  });
}
