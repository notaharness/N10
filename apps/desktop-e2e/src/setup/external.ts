import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { basename, join } from 'node:path';
import { listTaggedSessions, socketEnv, tagTmuxSession } from './tmux.js';

/**
 * Creating the things n10 is supposed to notice on its own: a
 * worktree and an agent session made without the app being involved,
 * the way a second n10, an Orchestra spawn or an operator at a shell
 * would make them — under any name, carrying the identity tags.
 *
 * Every call takes the test's `homeDir`, because the fixture launches
 * the app with `TMUX_TMPDIR=<homeDir>`. The env is built by `socketEnv`
 * in `./tmux.ts`, which proves the dir is a fixture home and drops
 * `$TMUX` — set whenever the suite itself runs inside tmux, and then
 * winning over `TMUX_TMPDIR`, so a session started "for the test" lands
 * on the developer's own server, where the app never sees it.
 */

/** Marker on every branch these helpers create. Cleanup refuses to
 *  touch anything without it. */
const E2E_BRANCH_PREFIX = 'e2e-ext-';

export function tmuxAvailable(): boolean {
  try {
    execFileSync('tmux', ['-V'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function uniqueExternalBranch(): string {
  return `${E2E_BRANCH_PREFIX}${randomBytes(3).toString('hex')}`;
}

/** The main checkout as n10 records it in `@orchestra-repo`: the
 *  symlink-resolved git toplevel, not the fixture's `repoPath`, which
 *  can differ when tmpdir is a symlink. */
export function repoRootOf(repoPath: string): string {
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

/** Add a worktree under the directory n10's resolver owns, with plain
 *  git. Returns its absolute path. */
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
 * session. Returns its name.
 *
 * `HOME` and `PATH` are pinned per session for the reason the backend
 * pins them: a tmux server keeps the environment it was started with,
 * so whichever process happened to start it would otherwise decide what
 * the agent sees.
 */
export function startExternalTmuxSession(opts: {
  repoPath: string;
  homeDir: string;
  branch: string;
  worktreePath: string;
  command: string;
  /** Further tags, on top of the identity every session carries. */
  tags?: Record<string, string>;
}): string {
  const name = n10TmuxLabel(opts.repoPath, opts.branch);
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
    { stdio: 'ignore', env: socketEnv(opts.homeDir) }
  );
  tagTmuxSession(
    name,
    {
      '@orchestra-spawner': 'n10',
      '@orchestra-repo': repoRootOf(opts.repoPath),
      '@orchestra-session-type': 'worktree',
      '@orchestra-branch': opts.branch,
      ...opts.tags,
    },
    opts.homeDir
  );
  return name;
}

/**
 * Kill the tmux sessions these helpers created, found by their branch
 * tag. The app's own exit path detaches rather than kills, so anything
 * left running would outlive the test.
 */
export function cleanupExternalSessions(
  repoPath: string,
  branches: string[],
  homeDir: string
): void {
  const root = repoRootOf(repoPath);
  for (const branch of branches) {
    if (!branch.startsWith(E2E_BRANCH_PREFIX)) {
      throw new Error(
        `refusing to clean up tmux sessions for non-e2e branch "${branch}"`
      );
    }
    const found = listTaggedSessions(homeDir).filter(
      (s) => s.type === 'worktree' && s.repo === root && s.branch === branch
    );
    for (const { name } of found) {
      try {
        execFileSync('tmux', ['kill-session', '-t', `=${name}:`], {
          stdio: 'ignore',
          env: socketEnv(homeDir),
        });
      } catch {
        /* already gone — best effort */
      }
    }
  }
}
