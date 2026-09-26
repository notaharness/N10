import { keyForWorktree } from '@n10/core';
import { type WorktreeInfo } from '@n10/worktree-manager';
import type { SidebarItem } from '@n10/core';

export interface EditorTargetDeps {
  listWorktrees: () => Promise<WorktreeInfo[]>;
  /** Idempotent: returns the existing worktree path if the branch is
   *  already checked out, otherwise creates one. */
  createWorktree: (branch: string) => Promise<string | null>;
}

/**
 * Resolve the filesystem path to open in an external editor for the
 * given sidebar item. For session rows the worktree always exists; for
 * PR rows (orphan or review) the worktree is created on demand so
 * `Shift+E` works even before the user has explicitly checked it out.
 *
 * Returns null when no path can be resolved (e.g. createWorktree
 * failed, or a session item has no matching worktree — which only
 * happens in stale UI state).
 */
export async function resolveEditorTarget(
  item: SidebarItem,
  deps: EditorTargetDeps
): Promise<string | null> {
  // A session row is its checkout; a PR row's worktree is whichever
  // checkout has the PR's branch.
  const worktrees = await deps.listWorktrees();
  const existing = worktrees.find((w) =>
    item.kind === 'session'
      ? keyForWorktree(w) === item.session.name
      : w.branch === item.pr.sourceBranch
  );
  if (existing) return existing.path;

  if (item.kind !== 'session') {
    return deps.createWorktree(item.pr.sourceBranch);
  }
  return null;
}
