/**
 * Git worktree lifecycle: creating a checkout for a branch, removing
 * one, deciding whether removal is safe, and rebasing one onto main.
 *
 * Manages .claude/worktrees/ directory for per-branch worktrees
 * used by the TUI to give each Claude session its own checkout.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { log } from '@n10/logger';
import { exec, gitOptions } from './exec.js';
import { isRemoteMachine, runGitOn, type Machine } from './machine.js';
import { assertShellSafeRef } from './refs.js';
import { worktreeDir } from './worktree-resolver.js';
import { listWorktrees, type WorktreeInfo } from './worktree-list.js';
import { getMainBranch } from './branches.js';

/** Throws for any function this phase left local-only: half-threading
 *  the machine seam (accepting one that is quietly ignored) is the
 *  data-loss bug this package's AGENTS.md warns about, so a caller
 *  that hands one of these a remote machine gets a loud failure
 *  instead of an operation silently run against the local repository. */
function refuseRemote(fn: string, machine: Machine | undefined): void {
  if (isRemoteMachine(machine))
    throw new Error(
      `${fn}() does not support a remote machine yet (${machine.id})`
    );
}

/**
 * Resolve the actual on-disk path of the worktree that has `branch`
 * checked out, by asking git rather than deriving it from the branch
 * name. A worktree's directory is independent of its branch name (git
 * lets you `worktree add <any-dir> <branch>`, and n10's resolver only
 * governs the dirs *it* creates), so the resolver-derived path can be
 * wrong for externally-created worktrees.
 *
 * Uses `listWorktrees` rather than the raw porcelain so a mid-rebase
 * worktree — which reports a detached HEAD with no `branch` line — still
 * matches via its recovered branch, and so the result is scoped to
 * n10-owned worktrees. Returns `null` if no owned worktree currently
 * has the branch checked out.
 */
async function worktreeForBranch(
  branch: string,
  cwd?: string,
  machine?: Machine
): Promise<WorktreeInfo | null> {
  const wt = (await listWorktrees(cwd, machine)).find(
    (w) => w.branch === branch
  );
  return wt ?? null;
}

async function worktreePathForBranch(
  branch: string,
  cwd?: string,
  machine?: Machine
): Promise<string | null> {
  return (await worktreeForBranch(branch, cwd, machine))?.path ?? null;
}

/**
 * Create a git worktree for a branch.
 * If the branch exists, checks it out. If not, creates a new branch from HEAD.
 * Returns the worktree path on success, null on failure.
 *
 * `machine` is local by default. A remote machine (D5) runs the same
 * two-step git sequence through its executor instead of a local fork —
 * see {@link createWorktreeRemote} for what that path cannot do that
 * the local one can.
 */
export async function createWorktree(
  branch: string,
  cwd = process.cwd(),
  machine?: Machine
): Promise<string | null> {
  assertShellSafeRef(branch);
  const relativeDir = worktreeDir(branch);
  const absoluteDir = resolve(cwd, relativeDir);
  if (isRemoteMachine(machine))
    return createWorktreeRemote(branch, cwd, relativeDir, absoluteDir, machine);

  const existingPath = await worktreePathForBranch(branch, cwd);
  if (existingPath) return existingPath;
  // A derived directory may belong to another branch. Never run an agent there.
  if (existsSync(absoluteDir)) return null;

  try {
    // Try existing branch first
    await exec(
      `git worktree add "${relativeDir}" "${branch}"`,
      gitOptions(cwd)
    );
    return absoluteDir;
  } catch (e) {
    log(
      'warn',
      'createWorktree',
      `existing branch checkout failed for ${branch}`,
      e
    );
    try {
      // Branch doesn't exist — create new branch from HEAD
      await exec(
        `git worktree add -b "${branch}" "${relativeDir}"`,
        gitOptions(cwd)
      );
      return absoluteDir;
    } catch (e2) {
      log(
        'error',
        'createWorktree',
        `new branch creation failed for ${branch}`,
        e2
      );
      return null;
    }
  }
}

/**
 * The remote twin of {@link createWorktree}'s two-step sequence, run
 * through `machine`'s executor. There is no filesystem on this side to
 * `existsSync` check against the remote directory before creating —
 * that guard is the git call's to make: `git worktree add` refuses an
 * occupied directory on its own, loudly, which is exactly what should
 * happen instead of a silent local fallback.
 */
async function createWorktreeRemote(
  branch: string,
  cwd: string,
  relativeDir: string,
  absoluteDir: string,
  machine: Machine
): Promise<string | null> {
  const existingPath = await worktreePathForBranch(branch, cwd, machine);
  if (existingPath) return existingPath;
  try {
    await runGitOn(machine, ['worktree', 'add', relativeDir, branch], cwd);
    return absoluteDir;
  } catch (e) {
    log(
      'warn',
      'createWorktree',
      `remote existing-branch checkout failed for ${branch} on ${machine.id}`,
      e
    );
    try {
      await runGitOn(
        machine,
        ['worktree', 'add', '-b', branch, relativeDir],
        cwd
      );
      return absoluteDir;
    } catch (e2) {
      log(
        'error',
        'createWorktree',
        `remote new-branch creation failed for ${branch} on ${machine.id}`,
        e2
      );
      return null;
    }
  }
}

/**
 * Check out a branch that already exists — locally, or on exactly one
 * remote, which git resolves to a tracking branch of the same name —
 * into its worktree, and return the path. Null when git refused,
 * which includes the branch not existing at all: unlike
 * {@link createWorktree}, this never invents a branch of that name
 * off HEAD. For a caller acting on a branch it did not choose (a pull
 * request's source branch), a new branch would put an agent to work
 * on the wrong base.
 *
 * `cwd` names the repository to add the worktree to. A caller that
 * outlives a change of the process's directory must pass it: the
 * worktree directory is resolved against it, and so is the git call.
 */
export async function checkoutWorktree(
  branch: string,
  cwd = process.cwd(),
  machine?: Machine
): Promise<string | null> {
  refuseRemote('checkoutWorktree', machine);
  assertShellSafeRef(branch);
  const relativeDir = worktreeDir(branch);
  const absoluteDir = resolve(cwd, relativeDir);

  // As in `createWorktree`: a worktree's directory is independent of
  // its branch name, so the path above only finds the ones n10 made
  // under the current template. Asking git — about `cwd`'s repository,
  // not the process's, since a caller here may outlive a change of
  // directory — is what stops a branch that is already checked out
  // somewhere from reading as "no worktree, and git refused to make
  // one", which for a babysitter means silently doing nothing.
  const existingPath = await worktreePathForBranch(branch, cwd);
  if (existingPath) return existingPath;
  if (existsSync(absoluteDir)) return null;

  try {
    await exec(
      `git worktree add "${relativeDir}" "${branch}"`,
      gitOptions(cwd)
    );
    return absoluteDir;
  } catch (e) {
    log('error', 'checkoutWorktree', `checkout failed for ${branch}`, e);
    return null;
  }
}

/**
 * Remove a git worktree for a branch.
 * Returns true on success, false on failure.
 *
 * `machine` is local by default. A remote machine (D5) removes the
 * worktree through its executor instead of a local fork — the
 * function this package's AGENTS.md exists to warn about: running
 * locally when the caller asked for a remote machine would delete the
 * wrong work, so this never falls back silently.
 */
export async function removeWorktree(
  branch: string,
  {
    force = false,
    cwd = process.cwd(),
    machine,
  }: { force?: boolean; cwd?: string; machine?: Machine } = {}
): Promise<boolean> {
  assertShellSafeRef(branch);
  // Prefer the worktree's real path from git; fall back to the
  // resolver-derived dir only if git doesn't know the branch.
  const target = await worktreePathForBranch(branch, cwd, machine);
  if (!target) return false;
  assertShellSafeRef(target, 'worktree path');
  const removeArgs = [
    'worktree',
    'remove',
    ...(force ? ['--force'] : []),
    target,
  ];
  if (isRemoteMachine(machine)) {
    try {
      await runGitOn(machine, removeArgs, cwd);
      return true;
    } catch (e) {
      log(
        'error',
        'removeWorktree',
        `remote git worktree remove failed for ${branch} on ${machine.id}`,
        e
      );
      return false;
    }
  }
  try {
    const forceFlag = force ? ' --force' : '';
    await exec(`git worktree remove${forceFlag} "${target}"`, gitOptions(cwd));
    return true;
  } catch (e) {
    log(
      'error',
      'removeWorktree',
      `git worktree remove failed for ${branch}`,
      e
    );
    return false;
  }
}

/**
 * Check whether a branch can be safely deleted.
 * Returns { safe: true } or { safe: false, reason: string }.
 */
export async function canRemoveBranch(
  branch: string,
  confirmedMerged = false,
  machine?: Machine
): Promise<{ safe: true } | { safe: false; reason: string }> {
  refuseRemote('canRemoveBranch', machine);
  assertShellSafeRef(branch);
  // Protected branch guard
  if (
    branch === 'main' ||
    branch === 'master' ||
    branch.startsWith('gitbutler')
  ) {
    return { safe: false, reason: 'protected branch' };
  }

  const wt = await worktreeForBranch(branch);

  // A mid-rebase worktree carries in-progress rebase state (recovered
  // from rebase-merge/rebase-apply) that force-removing the worktree
  // would silently destroy. Refuse to delete it — auto-delete and manual
  // delete both gate on this — so the user finishes or aborts the rebase
  // first.
  if (wt?.state === 'rebasing') {
    return { safe: false, reason: 'rebase in progress' };
  }

  // Use the worktree's real path from git so the status check runs
  // against the actual checkout, not a resolver-derived guess that may
  // not exist (which would silently skip the uncommitted-changes guard).
  const dir = wt?.path ?? worktreeDir(branch);

  if (await hasUncommittedChanges(dir, branch)) {
    return { safe: false, reason: 'uncommitted changes' };
  }

  // Skip when the VCS provider already confirmed the branch merged.
  if (!confirmedMerged && (await hasUnpushedCommits(branch))) {
    return { safe: false, reason: 'not pushed to upstream' };
  }

  return { safe: true };
}

/**
 * Whether the checkout at `dir` has anything uncommitted. A git call
 * that fails answers "no": the worktree may simply not exist, and this
 * guard is not the place to report that.
 */
async function hasUncommittedChanges(
  dir: string,
  branch: string
): Promise<boolean> {
  try {
    // Deliberately not `-z`: this output is only ever tested for
    // emptiness, so NUL termination would buy nothing. Add it before
    // parsing the entries — the newline form renders a rename as
    // `old -> new` in one field, which is the same trap `--numstat`
    // set with its brace form (see parseNumstat in @n10/app-core).
    const { stdout } = await exec(`git -C "${dir}" status --porcelain`, {
      encoding: 'utf8',
    });
    return stdout.trim().length > 0;
  } catch (e) {
    log('warn', 'canRemoveBranch', `status check failed for ${branch}`, e);
    return false;
  }
}

/**
 * Whether `branch` holds commits no remote has. As above, a failure
 * answers "no" — the branch may just have no remote tracking.
 */
async function hasUnpushedCommits(branch: string): Promise<boolean> {
  try {
    const { stdout } = await exec(`git log "${branch}" --not --remotes -1`, {
      encoding: 'utf8',
    });
    return stdout.trim().length > 0;
  } catch (e) {
    log('warn', 'canRemoveBranch', `unpushed check failed for ${branch}`, e);
    return false;
  }
}

/**
 * Fetch origin's main branch and rebase the worktree's branch onto it.
 * If conflicts arise, the rebase is automatically aborted.
 */
export async function rebaseOntoMaster(
  worktreePath: string,
  machine?: Machine
): Promise<'success' | 'conflict' | 'error'> {
  refuseRemote('rebaseOntoMaster', machine);
  assertShellSafeRef(worktreePath, 'worktree path');
  const main = await getMainBranch();
  try {
    await exec(`git -C "${worktreePath}" fetch origin ${main}`, {
      encoding: 'utf8',
    });
  } catch (e) {
    log('error', 'rebaseOntoMaster', `fetch origin ${main} failed`, e);
    return 'error';
  }
  try {
    await exec(`git -C "${worktreePath}" rebase origin/${main}`, {
      encoding: 'utf8',
    });
    return 'success';
  } catch (e) {
    log('warn', 'rebaseOntoMaster', 'rebase failed, aborting', e);
    try {
      await exec(`git -C "${worktreePath}" rebase --abort`, {
        encoding: 'utf8',
      });
    } catch (e2) {
      log('error', 'rebaseOntoMaster', 'rebase --abort failed', e2);
    }
    return 'conflict';
  }
}
