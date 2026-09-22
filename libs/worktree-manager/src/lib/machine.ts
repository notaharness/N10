/**
 * The seam a remote machine's git worktree lives behind (decisions.md
 * D5): the same argv this library would run locally through
 * `exec()`/`gitOptions()`, handed to something that runs it somewhere
 * else. Structurally identical to `@n10/core`'s `MachineExecutor` and
 * `@n10/terminal-tmux`'s — declared locally, not imported, because
 * core depends on this package and not the other way around.
 *
 * Only the functions that need this phase's remote launch flow accept
 * a `machine` parameter at all: `createWorktree`, `removeWorktree` and
 * `listWorktrees`. Every other function in this package stays
 * local-only. Passing a non-local `machine` to one of those throws
 * rather than silently acting on the local repository — see this
 * package's AGENTS.md ("the one thing that must not happen").
 */

export interface MachineExecutor {
  run(
    argv: string[],
    opts?: { cwd?: string; env?: Record<string, string>; stdin?: string }
  ): Promise<{ stdout: string; stderr: string; code: number }>;
}

/** A beam peerId, or `'local'` for this machine. Not a label — labels
 *  are renameable; the caller (core) resolves a peerId to a label for
 *  display. */
export const LOCAL_MACHINE_ID = 'local';

export interface Machine {
  id: string;
  executor: MachineExecutor;
}

export function isRemoteMachine(machine?: Machine): machine is Machine {
  return !!machine && machine.id !== LOCAL_MACHINE_ID;
}

/** Runs one git subcommand on `machine` via its executor, throwing with
 *  the remote's stderr on a nonzero exit — the same failure shape
 *  `exec()` gives a caller locally (a rejected promise), so callers
 *  need no separate remote error handling. */
export async function runGitOn(
  machine: Machine,
  args: string[],
  cwd?: string
): Promise<{ stdout: string; stderr: string }> {
  const result = await machine.executor.run(
    ['git', ...args],
    cwd ? { cwd } : undefined
  );
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || `git ${args.join(' ')} failed`);
  }
  return { stdout: result.stdout, stderr: result.stderr };
}
