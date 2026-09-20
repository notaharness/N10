import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readGlobalConfig } from '@n10/vcs-core';
import {
  configDirEnv,
  type ConfigDirToken,
} from '../agents/agent-config-dirs.js';

// ── The machine's half of a session's environment ────────────────
//
// `open-session` builds a session's environment from `process.env`
// plus an `additions` map. The two halves are not interchangeable:
// `process.env` describes the *orchestrating* process, while
// `additions` describes the launch, and a launch may one day happen on
// a machine that is not this one. So everything in `additions` has to
// be true of the machine the agent will run on.
//
// That is why nothing here accepts a path from its caller. A caller
// asks for a *capability* — "use the work Claude configuration",
// "don't share the git index" — and this module answers it against the
// machine it is running on, at the moment of launch. A machine-aware
// launcher runs the same resolution on the target host and gets that
// host's answer, rather than being handed this host's and having to
// undo it.

/** What a launch wants from the machine it lands on. */
export interface MachineEnvRequest {
  /**
   * Which registered Claude configuration directory to use, as a
   * token (`~/.claude-work`) — never an expanded path. Unset leaves
   * `CLAUDE_CONFIG_DIR` alone, so the host decides.
   *
   * **Local launches only** — see {@link machineEnvAdditions}.
   */
  configDir?: ConfigDirToken;
  /**
   * Give the session a git index of its own, so it cannot race the one
   * another agent in the same worktree is using. See
   * {@link isolatedIndexEnv}.
   */
  isolateGitIndex?: boolean;
  /**
   * Whether the session will run on this machine. Defaults to true,
   * which is every launch there is today.
   */
  local?: boolean;
}

/** Config directories only mean anything to the agent that reads them. */
const CONFIG_DIR_AGENTS = new Set(['claude']);

/**
 * The additions this machine contributes to a launch.
 *
 * `agent` is the resolved agent id; `cwd` is the directory the session
 * will run in.
 *
 * **The Claude configuration directory is deliberately local-only.**
 * A remote machine has its own home directory, its own credentials and
 * its own registered directories, and it is not this machine's business
 * to choose between them: a remote launch is sent no
 * `CLAUDE_CONFIG_DIR` at all and uses whatever that host defaults to.
 * That is the intended behaviour and not a gap to be filled — forwarding
 * this host's answer is the bug, which is why it is gated here rather
 * than left to a caller to remember. `sessionEnvFlags` in
 * `libs/terminal-tmux/src/lib/tmux-launch.ts` reasons the same way
 * about PATH and HOME.
 *
 * The isolated git index is unconditional by contrast: it describes the
 * checkout the session runs in, wherever that is, and the path it names
 * is created on that same machine.
 */
export function machineEnvAdditions(
  request: MachineEnvRequest | undefined,
  cwd: string,
  agent: string | undefined
): Record<string, string> {
  if (!request) return {};
  const localAgentConfig =
    request.local !== false && agent && CONFIG_DIR_AGENTS.has(agent);
  return {
    ...(localAgentConfig
      ? configDirEnv(request.configDir, readGlobalConfig().claudeConfigDirs)
      : {}),
    ...(request.isolateGitIndex ? isolatedIndexEnv(cwd) : {}),
  };
}

/**
 * Keep a session's git reads off the worktree's shared index.
 *
 * Two agents in one checkout collide on `.git/index` long before
 * either of them edits a file: `git status` and `git diff` refresh the
 * index's stat cache and *write it back*, so a session that only ever
 * looks at the diff still contends with one that is working. Two
 * things prevent that here, and both are enforcement rather than
 * instruction:
 *
 * - `GIT_OPTIONAL_LOCKS=0` tells git not to take the locks those
 *   opportunistic refreshes need, so reads stay reads.
 * - `GIT_INDEX_FILE` points at a private copy of the worktree's index,
 *   so anything that does write an index writes that one. The copy is
 *   taken at launch: the session sees staged state as it was when it
 *   started, which is the right answer for a review and is stated as
 *   such in the docs.
 *
 * The copy is deliberate. An *empty* scratch index would make every
 * tracked file read as newly added, so when the index cannot be copied
 * the variable is left unset and only the lock suppression applies —
 * degraded, but never wrong.
 */
function isolatedIndexEnv(cwd: string): Record<string, string> {
  const locks = { GIT_OPTIONAL_LOCKS: '0' };
  const source = gitIndexPath(cwd);
  if (!source) return locks;
  // One scratch index per worktree, not per launch: a relaunch
  // overwrites its predecessor instead of leaving another file behind.
  const dir = join(tmpdir(), 'n10-session-index');
  const target = join(
    dir,
    `${createHash('sha256').update(cwd).digest('hex').slice(0, 16)}.index`
  );
  try {
    mkdirSync(dir, { recursive: true });
    copyFileSync(source, target);
  } catch {
    return locks;
  }
  return { ...locks, GIT_INDEX_FILE: target };
}

/**
 * The worktree's own index file. A linked worktree keeps its index
 * under the main checkout's `.git/worktrees/<name>/`, so the path is
 * git's to answer, not ours to compose.
 */
function gitIndexPath(cwd: string): string | null {
  try {
    const out = execFileSync('git', ['rev-parse', '--git-path', 'index'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return out ? resolve(cwd, out) : null;
  } catch {
    return null;
  }
}
