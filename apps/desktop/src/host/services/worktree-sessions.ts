import { realpathSync } from 'node:fs';
import {
  keyForWorktree,
  listOurSessions,
  registryNameOf,
  sessionIdentity,
  type SidebarItem,
  type TaggedSession,
} from '@n10/core';
import type { WorktreeInfo } from '@n10/worktree-manager';

/**
 * Which agent session runs in each worktree, found by the directory it
 * runs in rather than by the branch it was started on.
 *
 * A session is keyed by the branch it was created for
 * (`@orchestra-branch`), and a worktree row by the branch checked out
 * in it now. The two part the moment someone runs `git switch` inside
 * the worktree: the row moves to the new branch's key, and the agent
 * still running there is left under a key no row names — the sidebar
 * reads it as not running and the tab strip has nothing to follow it
 * by. tmux still knows where the session runs (`#{session_path}`), and
 * that is what ties it back to its worktree.
 */
export interface MovedWorktreeSession {
  /** Registry name of the session running in the worktree. */
  name: string;
  /** The branch it was created for — no longer the one checked out. */
  branch: string;
}

function realPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/**
 * The held session in each worktree whose branch has moved on from the
 * one its session was created for, by the row's own key
 * (`keyForWorktree`). A worktree still on its session's branch needs no
 * entry, and wins over any other session in the same directory: that
 * one is the leftover from before the switch. Of several leftovers the
 * newest is the one last started there.
 *
 * tmux is only asked when a held session answers to no row's key —
 * the one sign a checkout has moved — so a sidebar poll with nothing
 * switched costs no fork.
 */
export function movedWorktreeSessions(
  worktrees: readonly Pick<WorktreeInfo, 'branch' | 'path'>[],
  repo: string,
  held: readonly string[],
  sessions: () => readonly TaggedSession[] = listOurSessions
): Map<string, MovedWorktreeSession> {
  const moved = new Map<string, MovedWorktreeSession>();
  const rowKeys = new Set(worktrees.map((wt) => keyForWorktree(wt, repo)));
  const heldNames = new Set(
    held.filter((name) => sessionIdentity(name)?.kind === 'worktree')
  );
  if ([...heldNames].every((name) => rowKeys.has(name))) return moved;
  const byPath = new Map<string, TaggedSession[]>();
  for (const s of sessions()) {
    if (s.type !== 'worktree' || !s.path) continue;
    if (!heldNames.has(registryNameOf(s))) continue;
    const at = realPath(s.path);
    byPath.set(at, [...(byPath.get(at) ?? []), s]);
  }
  for (const wt of worktrees) {
    const here = byPath.get(realPath(wt.path)) ?? [];
    if (here.length === 0 || here.some((s) => s.branch === wt.branch))
      continue;
    const newest = here.reduce((a, b) => (b.created > a.created ? b : a));
    moved.set(keyForWorktree(wt, repo), {
      name: registryNameOf(newest),
      branch: newest.branch,
    });
  }
  return moved;
}

/**
 * Point each moved worktree's row at the session that actually runs in
 * it. Applied after the rows are built, because every other lookup —
 * the row's pull request, which pull requests are orphans — is by the
 * branch checked out now, and must stay so.
 */
export function withMovedSessions(
  items: SidebarItem[],
  moved: ReadonlyMap<string, MovedWorktreeSession>,
  isAlive: (name: string) => boolean
): SidebarItem[] {
  if (moved.size === 0) return items;
  return items.map((item) => {
    if (item.kind !== 'session') return item;
    const session = moved.get(item.session.name);
    if (!session) return item;
    return {
      ...item,
      session: {
        ...item.session,
        name: session.name,
        running: isAlive(session.name),
        sessionBranch: session.branch,
      },
    };
  });
}
