/**
 * Enumerating the worktrees n10 owns: the porcelain parser, the
 * detached-HEAD recovery it depends on, and the listing that composes
 * the two.
 */
import { readFileSync } from 'node:fs';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { log } from '@n10/logger';
import { exec, gitOptions } from './exec.js';
import { isRemoteMachine, runGitOn, type Machine } from './machine.js';
import { branchToSessionName } from './refs.js';
import { ownsWorktreePath } from './worktree-resolver.js';

export interface WorktreeInfo {
  path: string;
  branch: string; // short branch name (no refs/heads/)
  bare: boolean;
  /**
   * Transient git state. `'rebasing'` means the worktree is mid-rebase
   * (HEAD detached, branch recovered from rebase-merge/rebase-apply
   * head-name). Absent means a normal attached checkout.
   */
  state?: 'rebasing';
}

/**
 * Stable session name for a worktree.
 *
 * Branch worktrees use the branch-derived name. A detached-HEAD
 * worktree has no branch, so we fall back to its directory name —
 * without this fallback `branchToSessionName('')` yields an empty
 * string, which renders as a blank sidebar row and can't be matched
 * back to its worktree to start a session.
 */
export function worktreeSessionName(wt: WorktreeInfo): string {
  return wt.branch ? branchToSessionName(wt.branch) : basename(wt.path);
}

/**
 * Parse `git worktree list --porcelain -z` output into WorktreeInfo[].
 *
 * `-z` terminates each attribute with NUL rather than a newline, which
 * is what makes a worktree path containing one parseable at all — the
 * newline-delimited form would split such a path across two attributes
 * and lose the worktree. Blocks are separated by the empty attribute
 * that terminates each one, so an extra NUL.
 */
export function parseWorktrees(output: string): WorktreeInfo[] {
  const results: WorktreeInfo[] = [];
  const blocks = output.split('\0\0').filter((b) => b.length > 0);

  for (const block of blocks) {
    const lines = block.split('\0').filter(Boolean);
    let path = '';
    let branch = '';
    let bare = false;

    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        path = line.slice('worktree '.length);
      } else if (line.startsWith('branch refs/heads/')) {
        branch = line.slice('branch refs/heads/'.length);
      } else if (line === 'bare') {
        bare = true;
      }
    }

    if (path) {
      results.push({ path, branch, bare });
    }
  }

  return results;
}

/**
 * For a detached-HEAD worktree, try to recover the logical branch from
 * an in-progress rebase. Git stores the original branch in
 * `<gitdir>/rebase-merge/head-name` (interactive) or
 * `<gitdir>/rebase-apply/head-name` (non-interactive) as
 * `refs/heads/<branch>`. Returns `null` if the worktree is not
 * mid-rebase or anything is unreadable.
 *
 * Without this, every consumer that keys off `branchToSessionName(wt.branch)`
 * (sidebar items, session keys, PR linkage) collapses on the empty
 * string and the sidebar gets stuck on duplicate empty rows.
 */
export function recoverRebaseBranch(worktreePath: string): string | null {
  try {
    // The worktree's `.git` is a file containing `gitdir: <path>`
    // pointing into the main repo's `.git/worktrees/<name>` directory.
    const dotGit = readFileSync(join(worktreePath, '.git'), 'utf8');
    const match = dotGit.match(/^gitdir:\s*(.+)$/m);
    if (!match) return null;
    const rawGitdir = match[1]!.trim();
    const gitdir = isAbsolute(rawGitdir)
      ? rawGitdir
      : resolve(worktreePath, rawGitdir);

    for (const sub of ['rebase-merge', 'rebase-apply']) {
      try {
        const headName = readFileSync(
          join(gitdir, sub, 'head-name'),
          'utf8'
        ).trim();
        if (headName.startsWith('refs/heads/')) {
          return headName.slice('refs/heads/'.length);
        }
      } catch {
        // No rebase of this kind in progress; try the next one.
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * List git worktrees under .claude/worktrees/ for the current repo.
 * Skips the main worktree and bare entries.
 *
 * Detached-HEAD worktrees: if a rebase is in progress, the branch is
 * recovered from `rebase-{merge,apply}/head-name` and `state` is set
 * to `'rebasing'`. True orphans (detached, no recoverable branch —
 * e.g. branch was deleted under the worktree, or `git worktree add`
 * was run with a SHA) are kept with an empty `branch`; consumers name
 * them via `worktreeSessionName` (directory basename) so they render
 * in the sidebar and can host a session by their directory name.
 *
 * `cwd` names the repository to list, and to judge ownership against.
 * Omitting it runs against the process's directory, which is the open
 * repository — what every caller polling for the sidebar wants. A
 * caller acting on a repository it was handed passes it, so the answer
 * cannot be about somewhere the desktop `chdir`-ed to meanwhile.
 *
 * `machine` is local by default. A remote machine runs the same `git
 * worktree list --porcelain -z` through its executor instead of a
 * local fork — but cannot recover a detached-HEAD worktree's rebase
 * branch (`recoverRebaseBranch` reads the remote's `.git` directory
 * directly, which only makes sense against this machine's filesystem),
 * so a remote mid-rebase worktree is reported detached rather than
 * with its recovered branch. Everything else is unchanged.
 */
export async function listWorktrees(
  cwd?: string,
  machine?: Machine
): Promise<WorktreeInfo[]> {
  if (isRemoteMachine(machine)) return listWorktreesRemote(cwd, machine);
  try {
    const { stdout } = await exec(
      'git worktree list --porcelain -z',
      gitOptions(cwd)
    );
    return recoverDetachedHeads(
      parseWorktrees(stdout),
      cwd,
      recoverRebaseBranch
    );
  } catch (e) {
    log('error', 'listWorktrees', 'git worktree list failed', e);
    return [];
  }
}

async function listWorktreesRemote(
  cwd: string | undefined,
  machine: Machine
): Promise<WorktreeInfo[]> {
  try {
    const { stdout } = await runGitOn(
      machine,
      ['worktree', 'list', '--porcelain', '-z'],
      cwd
    );
    // No local filesystem to recover a detached HEAD's rebase branch
    // from — see this function's doc comment.
    return recoverDetachedHeads(parseWorktrees(stdout), cwd, () => null);
  } catch (e) {
    log(
      'error',
      'listWorktrees',
      `remote git worktree list failed on ${machine.id}`,
      e
    );
    return [];
  }
}

function recoverDetachedHeads(
  parsed: WorktreeInfo[],
  cwd: string | undefined,
  recover: (worktreePath: string) => string | null
): WorktreeInfo[] {
  const owned = parsed.filter((w) => !w.bare && ownsWorktreePath(w.path, cwd));
  const recovered: WorktreeInfo[] = [];
  for (const w of owned) {
    if (w.branch !== '') {
      recovered.push(w);
      continue;
    }
    const rebaseBranch = recover(w.path);
    if (rebaseBranch) {
      recovered.push({ ...w, branch: rebaseBranch, state: 'rebasing' });
    } else {
      // True orphan (detached, no rebase in progress — e.g. a
      // `git worktree add --detach <SHA>`). Keep it with an empty
      // branch: consumers name it via `worktreeSessionName`, which
      // falls back to the directory basename, so it renders in the
      // sidebar and can host a session by its directory name.
      recovered.push(w);
    }
  }
  return recovered;
}
