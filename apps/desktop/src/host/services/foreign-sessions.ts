import { realpathSync } from 'node:fs';
import { listLiveWorktreeSessions } from '@n10/core';
import type { ForeignSessionSummary } from '../contract.js';
import { ensureRecent } from './recent-repos.js';
import { requireRepo } from './repo.js';

/** The foreign set as last answered, so the repo list is written only
 *  when it changes: this is a polled read, and the list is the user's
 *  — a repository they removed must not come back on every tick. */
let lastAnswered = '';

/**
 * Agents alive in repositories other than the open one.
 *
 * The host attaches only the open repository's sessions — it is
 * single-repo by construction — but tmux holds every repository's, and
 * a tab strip that spans repositories wants each of them back in its
 * own group after a relaunch. So this lists the rest as strip entries
 * only: repository, branch, session name, nothing attached. Activating
 * one opens its repository, and that repository's own discovery
 * attaches the agent through the normal path.
 *
 * The open repository's own agents are left out: the sidebar describes
 * those, and listing them here as well would open each twice. So is an
 * agent in a worktree on a detached HEAD: the desktop attaches by
 * branch (`discovery.ts` refuses one with none), so its tab would open
 * the repository and then attach nothing.
 */
export function listForeignSessions(): ForeignSessionSummary[] {
  const open = requireRepo();
  // Identity is the real path — the same string git reports as the
  // toplevel, which is what the core derives a session's repository
  // from — so a repository opened through a symlink still recognises
  // its own agents as its own.
  let openRoot: string;
  try {
    openRoot = realpathSync(open);
  } catch {
    openRoot = open;
  }
  const out: ForeignSessionSummary[] = [];
  for (const live of listLiveWorktreeSessions()) {
    if (live.repoRoot === openRoot || live.detached) continue;
    out.push({
      repo: live.repoRoot,
      branch: live.branch,
      worktree: live.path,
      sessionName: live.sessionName,
    });
  }
  noteRepositories(out);
  return out;
}

/** Put each foreign repository on the repo list — so the tab's
 *  repository can be opened like any other, the same courtesy a
 *  restored terminal's gets — once per change of the foreign set. */
function noteRepositories(foreign: ForeignSessionSummary[]): void {
  const answered = foreign
    .map((s) => `${s.repo}\0${s.sessionName}`)
    .sort()
    .join('\n');
  if (answered === lastAnswered) return;
  lastAnswered = answered;
  for (const repo of new Set(foreign.map((s) => s.repo))) ensureRecent(repo);
}
