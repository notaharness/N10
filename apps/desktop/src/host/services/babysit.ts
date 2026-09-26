/**
 * Host-side ownership of pull request babysitters.
 *
 * What to watch, what counts as news and when to tell the agent all
 * live in `@n10/core`; what the desktop adds is the same thing it
 * adds to every other launch — adopting a session core spawned so its
 * output reaches the renderer. Status travels on the sidebar item
 * (`getSidebarSnapshot` decorates the rows from `babysatStatuses`),
 * so the renderer is pushed to only for what a poll would show too
 * late: an agent started, or a watch ended.
 *
 * Babysitters are kept per repository, because the tab strip spans
 * repositories and switching back and forth is normal: one for a repo
 * that is not open sits out its ticks (`isCurrent`) rather than being
 * torn down, so switching away and back does not lose what the agent
 * has already been told. They are in memory only — a restart starts
 * from nothing, and so does the first update after it.
 */
import {
  startPrBabysitter,
  type BabysitStatus,
  type PrBabysitter,
} from '@n10/core';
import type { BabysitChangedEvent } from '../contract.js';
import { readConfig } from '@n10/vcs-core';
import { activeRepoIs, requireRepo } from './repo.js';
import {
  adoptSpawnedSession,
  defaultPaneSize,
  isForeignSession,
} from './sessions.js';
import { lookupPullRequest, repoProvider } from './pull-requests.js';

interface Sitter {
  handle: PrBabysitter;
  sourceBranch: string;
}

/** cwd → pull request id → its babysitter. */
const sitters = new Map<string, Map<number, Sitter>>();

// Installed by main.ts. Fires when a babysitter started an agent or
// ended — the two things the sidebar's next poll would show too late.
let changed: ((event: BabysitChangedEvent) => void) | null = null;

export function setBabysitNotifier(
  fn: ((event: BabysitChangedEvent) => void) | null
): void {
  changed = fn;
}

function forRepo(cwd: string): Map<number, Sitter> {
  let byId = sitters.get(cwd);
  if (!byId) {
    byId = new Map();
    sitters.set(cwd, byId);
  }
  return byId;
}

/**
 * Start babysitting a pull request of the open repository. Starting
 * one that is already babysat is a no-op that answers with its status,
 * so a double click cannot stand up two watchers on one agent.
 */
export async function startBabysit(prId: number): Promise<BabysitStatus> {
  const cwd = requireRepo();
  const existing = forRepo(cwd).get(prId);
  if (existing) return existing.handle.status();
  const lookup = await lookupPullRequest(cwd, prId);
  if (lookup.kind !== 'found') {
    throw new Error(`Pull request #${prId} is not in the sidebar`);
  }
  const { pr } = lookup;
  const handle = startPrBabysitter({
    pr,
    cwd,
    getProvider: () => repoProvider(cwd),
    getConfig: () => readConfig(cwd),
    readPullRequest: () => lookupPullRequest(cwd, prId),
    paneSize: defaultPaneSize,
    onSpawned: (name) => {
      adoptSpawnedSession(name);
      changed?.({ spawned: { prId, name } });
    },
    isForeignSession,
    onStatus: (status) => {
      // A babysitter that ended (the pull request merged or closed)
      // leaves the list, so the row stops offering to stop it — and
      // the renderer is told which one, since the row it was on is
      // usually gone with it.
      if (status.phase !== 'ended') return;
      forRepo(cwd).delete(prId);
      changed?.({ ended: { prId, sourceBranch: pr.sourceBranch } });
    },
    isCurrent: () => activeRepoIs(cwd),
  });
  forRepo(cwd).set(prId, { handle, sourceBranch: pr.sourceBranch });
  return handle.status();
}

/** Stop babysitting. Nothing to stop is not an error. */
export function stopBabysit(prId: number): void {
  const byId = forRepo(requireRepo());
  const sitter = byId.get(prId);
  if (!sitter) return;
  sitter.handle.stop();
  byId.delete(prId);
}

/**
 * Stop babysitting whichever pull request `branch` is the source of,
 * in the open repository. Worktree removal calls this first: a watcher
 * left behind would start a fresh agent in a fresh checkout at its
 * next update, undoing the removal.
 */
export function stopBabysitForBranch(branch: string): void {
  const byId = forRepo(requireRepo());
  for (const [prId, sitter] of byId) {
    if (sitter.sourceBranch !== branch) continue;
    sitter.handle.stop();
    byId.delete(prId);
  }
}

/** The babysitters of `cwd`, by pull request id — what the sidebar
 *  decorates its rows with. */
export function babysatStatuses(cwd: string): Map<number, BabysitStatus> {
  const out = new Map<number, BabysitStatus>();
  for (const [prId, sitter] of forRepo(cwd)) {
    out.set(prId, sitter.handle.status());
  }
  return out;
}

/** Every babysitter of every repository. For app exit. */
export function stopAllBabysitters(): void {
  for (const byId of sitters.values()) {
    for (const sitter of byId.values()) sitter.handle.stop();
  }
  sitters.clear();
}
