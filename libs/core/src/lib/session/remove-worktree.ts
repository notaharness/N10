import {
  listWorktrees,
  removeWorktree,
  deleteBranch,
} from '@n10/worktree-manager';
import { stopSession } from './stop-session.js';
import { getRepoRoot } from '../repo-root.js';
import { keyForWorktree } from '../session-key.js';

/** Stop the agent in the checkout that has `branch`, before deleting
 *  that checkout. The session belongs to the checkout, so it is found by
 *  the worktree's path — never by the branch it was created for, which
 *  another worktree may have checked out since. */
export async function removeWorktreeSession(
  branch: string,
  force: boolean,
  repo?: string
): Promise<boolean> {
  const cwd = repo ?? getRepoRoot() ?? process.cwd();
  const worktree = (await listWorktrees(cwd)).find((w) => w.branch === branch);
  if (worktree) stopSession(keyForWorktree(worktree, cwd));
  const removed = await removeWorktree(branch, { force, cwd });
  if (removed) await deleteBranch(branch, true, cwd);
  return removed;
}
