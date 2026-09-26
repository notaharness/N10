import { keyForWorktree } from '../session-key.js';
import {
  canRemoveBranch,
  fastForwardMainBranch,
  listWorktrees,
} from '@n10/worktree-manager';
import { logError } from '@n10/logger';
import type { AppConfig, BranchPrMap, VcsProvider } from '@n10/vcs-core';
import { isSessionAlive } from '../pty-registry.js';
import { hasLiveTmuxSession } from '../session-backend.js';
import { countBranchConflicts } from './conflicts.js';
import { fetchRefs } from './fetch-queue.js';

// ── Remote sync core ─────────────────────────────────────────────
//
// The shell-agnostic heart of the remote sync loop: fetch + fast-
// forward, the merged-branch sweep (with auto-delete-on-merge), and
// batch conflict counting. The TUI drives these from its hooks
// (useRemoteSync / useMergedBranches / useConflictCounts); the desktop
// host drives them from a timer. Behavior lives here exactly once —
// the shells only own scheduling and how results are displayed.

export const REMOTE_SYNC_DEFAULT_MS = 3_600_000; // 1 hour
export const REMOTE_SYNC_MIN_MS = 300_000; // 5 minutes

export function remoteSyncIntervalMs(
  mergePollInterval: number | undefined
): number {
  return Math.max(
    REMOTE_SYNC_MIN_MS,
    mergePollInterval ?? REMOTE_SYNC_DEFAULT_MS
  );
}

/** One sync pass: fetch all remotes (pruning), through the fetch line
 *  every other fetch of the repository waits in, and fast-forward the
 *  main branch. Never throws; returns the completion timestamp. */
export async function syncRemote(cwd = process.cwd()): Promise<number> {
  try {
    await fetchRefs({ cwd, refs: 'all' });
    await fastForwardMainBranch();
  } catch (err: unknown) {
    logError('remote-sync', err);
  }
  return Date.now();
}

/**
 * Decide which mid-rebase branches to warn about this sync without
 * re-warning ones already flagged. Given the branches currently blocked
 * from auto-delete by an in-progress rebase and the set warned on the
 * previous sync, return the branches to warn about now plus the set to
 * carry forward. A branch drops out of the carried set once it stops
 * rebasing, so a later rebase of the same branch warns again instead of
 * staying silent.
 */
export function diffRebaseWarnings(
  rebasingNow: readonly string[],
  alreadyWarned: ReadonlySet<string>
): { toWarn: string[]; nextWarned: Set<string> } {
  return {
    toWarn: rebasingNow.filter((branch) => !alreadyWarned.has(branch)),
    nextWarned: new Set(rebasingNow),
  };
}

/**
 * The slice of config the sweep reads. Narrow on purpose: callers with
 * a full AppConfig may pass it, but the sweep must not depend on
 * unrelated config churn.
 */
type SweepConfig = Pick<
  AppConfig,
  'vendorAuth' | 'vendorProject' | 'autoDeleteOnMerge'
>;

/**
 * Delete the worktrees of merged branches that are safe to delete, and
 * return the ones a rebase is holding up. Null means the caller
 * cancelled partway, which is not the same as "nothing was blocked".
 */
async function autoDeleteMerged(args: {
  merged: Set<string>;
  onAutoDelete: (sessionName: string, branch: string) => void | Promise<void>;
  isCancelled: () => boolean;
}): Promise<string[] | null> {
  const { merged, onAutoDelete, isCancelled } = args;
  const rebasingNow: string[] = [];
  // One listing for the pass: each merged branch's session is the one in
  // the checkout that has it.
  const checkouts = await listWorktrees();
  for (const branch of merged) {
    // A live agent prevents auto-deletion even when n10 is detached.
    // Deleting its working directory would disrupt the running process.
    const checkout = checkouts.find((w) => w.branch === branch);
    if (!checkout) continue;
    const sessionName = keyForWorktree(checkout);
    if (isSessionAlive(sessionName) || hasLiveTmuxSession(sessionName)) {
      logError(
        'sweepMergedBranches',
        `Skipping auto-delete of ${branch}: agent session is running`
      );
      continue;
    }
    const check = await canRemoveBranch(branch, true);
    if (isCancelled()) return null;
    if (check.safe) {
      await onAutoDelete(sessionName, branch);
    } else {
      if (check.reason === 'rebase in progress') rebasingNow.push(branch);
      logError(
        'sweepMergedBranches',
        `Skipping auto-delete of ${branch}: ${check.reason}`
      );
    }
  }
  return rebasingNow;
}

export interface MergedSweepResult {
  /** Branches (of those given) whose PRs have been merged. */
  merged: Set<string>;
  /** Carry this into the next sweep's `warnedRebase`. */
  nextWarned: Set<string>;
}

/**
 * Fetch which of `branches` have merged PRs and, when
 * `config.autoDeleteOnMerge` is on, auto-delete the ones that are safe
 * to remove (`canRemoveBranch(branch, true)`), warning once per rebase
 * episode about branches blocked by an in-progress rebase.
 */
export async function sweepMergedBranches(opts: {
  provider: VcsProvider | null;
  vcsConfigured: boolean;
  config: SweepConfig;
  branches: string[];
  /** Branches already warned about an in-progress rebase. */
  warnedRebase: ReadonlySet<string>;
  /** Fires with the merged set as soon as it is known, before the
   *  (potentially slow) auto-delete pass — lets UIs show merged
   *  badges without waiting for deletions. */
  onMerged?: (merged: Set<string>) => void;
  onAutoDelete: (sessionName: string, branch: string) => void | Promise<void>;
  onRebaseInProgress: (branch: string) => void;
  /** Abort between async steps (the TUI passes its effect-cancel flag). */
  isCancelled?: () => boolean;
}): Promise<MergedSweepResult> {
  const {
    provider,
    vcsConfigured,
    config,
    branches,
    warnedRebase,
    onMerged,
    onAutoDelete,
    onRebaseInProgress,
    isCancelled = () => false,
  } = opts;
  const keepWarned = new Set(warnedRebase);
  const fetchMerged = provider?.fetchMergedBranches;
  if (!fetchMerged || !vcsConfigured || branches.length === 0) {
    return { merged: new Set(), nextWarned: keepWarned };
  }

  let merged: Set<string>;
  try {
    merged = await fetchMerged(
      config.vendorAuth,
      config.vendorProject,
      branches
    );
  } catch (err: unknown) {
    logError('fetchMergedBranches', err);
    merged = new Set<string>();
  }
  if (isCancelled()) return { merged, nextWarned: keepWarned };
  onMerged?.(merged);
  if (!config.autoDeleteOnMerge) {
    return { merged, nextWarned: keepWarned };
  }

  const rebasingNow = await autoDeleteMerged({
    merged,
    onAutoDelete,
    isCancelled,
  });
  if (rebasingNow === null) return { merged, nextWarned: keepWarned };

  const { toWarn, nextWarned } = diffRebaseWarnings(rebasingNow, warnedRebase);
  for (const branch of toWarn) onRebaseInProgress(branch);
  return { merged, nextWarned };
}

/**
 * Batch conflict counting, by the one predicate the babysitter uses
 * too (`conflicts.ts`): a branch with a pull request in `prMap` is
 * judged on the remote refs against its target; the rest locally
 * against origin's main branch. A branch that fails to check counts 0.
 */
export async function computeConflictCounts(
  branches: string[],
  prMap: BranchPrMap = {},
  cwd?: string
): Promise<Map<string, number>> {
  const entries = await Promise.all(
    branches.map(async (branch) => {
      try {
        const count = await countBranchConflicts(
          branch,
          prMap[branch] ?? undefined,
          cwd
        );
        return [branch, count] as const;
      } catch {
        return [branch, 0] as const;
      }
    })
  );
  return new Map(entries);
}
