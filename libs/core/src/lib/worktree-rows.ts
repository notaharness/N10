import { listWorktrees, type WorktreeInfo } from '@n10/worktree-manager';
import { getSession } from './pty-registry.js';
import { getRepoRoot } from './repo-root.js';
import { keyForWorktree } from './session-key.js';
import type { AgentSession } from './types.js';

/**
 * A worktree as a sidebar session row, the same in both shells.
 *
 * The row is keyed by the checkout (`keyForWorktree`), so the agent
 * running there stays the row's across `git switch`, a branch rename
 * or a detached HEAD, and a second worktree on the branch the agent
 * was created for never claims it. `sessionBranch` says when the
 * checkout has moved on from that branch.
 */
export function worktreeSessionRow(
  wt: Pick<WorktreeInfo, 'branch' | 'path' | 'state'>,
  isAlive: (name: string) => boolean,
  repo?: string
): AgentSession {
  const name = keyForWorktree(wt, repo);
  const createdFor = getSession(name)?.createdFor;
  return {
    name,
    label: wt.branch || wt.path.split('/').pop(),
    branch: wt.branch,
    path: wt.path,
    running: isAlive(name),
    ...(wt.state ? { state: wt.state } : {}),
    ...(createdFor && wt.branch && createdFor !== wt.branch
      ? { sessionBranch: createdFor }
      : {}),
  };
}

/** The row of the worktree that has `branch` checked out, if any. */
export function sessionForBranch(
  sessions: readonly AgentSession[],
  branch: string
): AgentSession | undefined {
  return sessions.find((s) => s.branch === branch);
}

/**
 * The session key of the checkout that has `branch` checked out, or
 * `null` when none has — for the callers that start from a pull
 * request's branch rather than a worktree. A session is found through
 * its checkout, never by the branch it was created for.
 */
export async function sessionKeyForBranch(
  branch: string,
  repo = getRepoRoot() ?? process.cwd()
): Promise<string | null> {
  const worktree = (await listWorktrees(repo)).find((w) => w.branch === branch);
  return worktree ? keyForWorktree(worktree, repo) : null;
}
