import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { basename, resolve } from 'node:path';

/**
 * Helpers for asserting on the tmux sessions the desktop app creates.
 *
 * Every call takes the test's `desktop.homeDir`: the fixture launches
 * the app with `TMUX_TMPDIR=<homeDir>`, so each test's tmux server
 * listens on a socket inside its own temp home rather than the shared
 * /tmp/tmux-$UID one.
 *
 * A session's name is a label (`<repo>-<branch>`, `<repo>-shell`, with
 * a numeric suffix on collision) and is never parsed. What makes a
 * session n10's is its tags — `@orchestra-spawner`,
 * `@orchestra-session-type`, `@orchestra-repo`, `@orchestra-branch` —
 * so every helper here lists with the tags and matches on them,
 * exactly as the app does.
 */

/** Basename prefix of the temp homes the fixture creates. The tmux
 *  socket lives inside one, and `socketEnv` refuses any other dir. */
const HOME_PREFIX = 'n10-desktop-e2e-home-';

export function tmuxAvailable(): boolean {
  try {
    execFileSync('tmux', ['-V'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
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
export function socketEnv(tmuxTmpdir: string): NodeJS.ProcessEnv {
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
  worktreePath: string;
}

const LISTING = [
  '#{session_name}',
  '#{@orchestra-spawner}',
  '#{@orchestra-session-type}',
  '#{@orchestra-repo}',
  '#{@orchestra-branch}',
  '#{@orchestra-worktree-path}',
].join('\t');

/** Every session on the test's tmux server, tags included. Empty when
 *  no server is running — tmux exits non-zero for that, which is not
 *  an error here. */
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
          worktreePath = '',
        ] = line.split('\t');
        return { name, spawner, type, repo, branch, worktreePath };
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

/** Write n10's identity tags on a session the test created itself. */
export function tagTmuxSession(
  name: string,
  tags: Record<string, string>,
  tmuxTmpdir: string
): void {
  const env = socketEnv(tmuxTmpdir);
  for (const [key, value] of Object.entries(tags)) {
    execFileSync('tmux', ['set-option', '-t', `=${name}:`, key, value], {
      stdio: 'ignore',
      env,
    });
  }
}

/** End one session on the test's server from outside the app — what
 *  an operator's `tmux kill-session` looks like to a terminal tab. */
export function killTmuxSession(name: string, tmuxTmpdir: string): void {
  try {
    execFileSync('tmux', ['kill-session', '-t', `=${name}:`], {
      stdio: 'ignore',
      env: socketEnv(tmuxTmpdir),
    });
  } catch {
    /* already gone — best effort */
  }
}

/** Detach every client from one session on the test's server, leaving
 *  the session running — what the detach key inside tmux does. */
export function detachTmuxClients(name: string, tmuxTmpdir: string): void {
  execFileSync('tmux', ['detach-client', '-s', `=${name}:`], {
    stdio: 'ignore',
    env: socketEnv(tmuxTmpdir),
  });
}

/**
 * Teardown for tmux-backed tests. Closing the app deliberately only
 * *detaches*, so a tmux-backed test would otherwise leave a live
 * session (holding a fake agent) behind on its own socket — which is
 * removed with the temp home, orphaning the server.
 */
export function killN10Sessions(tmuxTmpdir: string): void {
  for (const name of n10Sessions(tmuxTmpdir)) {
    killTmuxSession(name, tmuxTmpdir);
  }
}

/** Clean up all sessions on this fixture's private socket, including an
 * untagged session left by an interrupted launch. */
export function killFixtureSessions(homeDir: string): void {
  for (const name of listTmuxSessions(homeDir)) {
    killTmuxSession(name, homeDir);
  }
}

/** Connected client processes, for waiting on transport reconnection. */
export function tmuxClientPids(name: string, homeDir: string): string[] {
  return execFileSync(
    'tmux',
    ['list-clients', '-t', `=${name}:`, '-F', '#{client_pid}'],
    {
      env: socketEnv(homeDir),
      encoding: 'utf8',
    }
  )
    .trim()
    .split('\n')
    .filter(Boolean);
}
