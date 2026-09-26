import type { AgentSession } from '../types.js';

import {
  isBlockingDecision,
  type BranchPrMap,
  type PullRequestInfo,
  type CategorizedReviews,
  type AppConfig,
  type VcsProvider,
} from '@n10/vcs-core';

/**
 * Find PRs created by the current user whose branch no worktree has
 * checked out.
 */
export function findOrphanPrs(
  prMap: BranchPrMap,
  checkedOut: ReadonlySet<string>,
  config: AppConfig,
  provider: VcsProvider
): PullRequestInfo[] {
  return Object.values(prMap)
    .filter(
      (pr): pr is PullRequestInfo =>
        pr != null &&
        provider.matchesUser(pr.createdByIdentifier, config) &&
        !checkedOut.has(pr.sourceBranch)
    )
    .sort((a, b) => b.id - a.id);
}

/**
 * Categorize PRs where the current user is a reviewer.
 */
export function categorizeReviews(
  prMap: BranchPrMap,
  config: AppConfig,
  provider: VcsProvider
): CategorizedReviews {
  const needsReview: PullRequestInfo[] = [];
  const waitingForAuthor: PullRequestInfo[] = [];
  const approvedByYou: PullRequestInfo[] = [];

  for (const pr of Object.values(prMap)) {
    if (!pr || !pr.reviewers) continue;
    // Skip PRs created by the current user — they belong in sessions, not reviews
    if (provider.matchesUser(pr.createdByIdentifier, config)) continue;
    const reviewer = pr.reviewers.find((r) =>
      provider.matchesUser(r.identifier, config)
    );
    if (!reviewer) continue;
    if (reviewer.decision === 'declined') continue;
    if (reviewer.decision === 'approved') {
      approvedByYou.push(pr);
    } else if (isBlockingDecision(reviewer.decision)) {
      waitingForAuthor.push(pr);
    } else if (!pr.isDraft) {
      // A draft is not asking for review yet, so it does not belong in
      // "Needs Your Review" — being listed there is a standing job that
      // cannot be cleared. The other two buckets still take drafts:
      // both record a decision already made, and one of them ("Waiting
      // for Author") is exactly where a PR put back into draft belongs.
      needsReview.push(pr);
    }
  }
  return { needsReview, waitingForAuthor, approvedByYou };
}

/**
 * Map each worktree session's name to the pull request of the branch
 * checked out in it now.
 */
export function buildSessionPrMap(
  prMap: BranchPrMap,
  sessions: readonly AgentSession[]
): Map<string, PullRequestInfo> {
  const sessionPrMap = new Map<string, PullRequestInfo>();
  for (const session of sessions) {
    const pr = session.branch ? prMap[session.branch] : undefined;
    if (pr) sessionPrMap.set(session.name, pr);
  }
  return sessionPrMap;
}
