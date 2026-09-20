import { buildBackgroundReviewRequest, resolveAgent } from '@n10/core';
import { readConfig } from '@n10/vcs-core';
import { createWorktree } from '@n10/worktree-manager';
import type { ReviewLaunchRequest } from '../contract.js';
import { requireRepo } from './repo.js';
import { launchReviewTerminal } from './terminals.js';

/**
 * Starting an AI review.
 *
 * Its own module because a review is no longer a kind of worktree
 * launch: it resolves the checkout, then asks the terminals service
 * for a session beside the branch's agent rather than in place of it.
 * `sessions.ts` re-exports it, so the bridge is unchanged.
 */

/** What launching a review hands back to the caller. */
interface LaunchResult {
  name: string;
}

const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 40;

/**
 * Start an AI review of `req.pr` in a background session of its own.
 *
 * The agent working on the branch keeps its session and keeps working;
 * the review gets a separate one against the same checkout, with its
 * own git index. It surfaces as a terminal tab rather than taking over
 * the branch's pane — see `terminals.ts` and `docs/decisions.md`.
 */
const inflightReviews = new Map<string, Promise<LaunchResult>>();

export function launchReviewAgent(
  req: ReviewLaunchRequest
): Promise<LaunchResult> {
  // The renderer disables the button while a launch is in flight, but
  // a second click can beat the state update. Joining the pending
  // promise makes it a no-op — without this the second launch would
  // end the first one's session as "the previous review of this pull
  // request" while it was still starting.
  const key = `${requireRepo()}\u0000${req.pr.id}`;
  const pending = inflightReviews.get(key);
  if (pending) return pending;
  const promise = doLaunchReview(req).finally(() =>
    inflightReviews.delete(key)
  );
  inflightReviews.set(key, promise);
  return promise;
}

async function doLaunchReview(req: ReviewLaunchRequest): Promise<LaunchResult> {
  const repoCwd = requireRepo();
  const branch = req.pr.sourceBranch;
  // The worktree still has to exist — the review reads it — but the
  // session it gets is its own, so nothing here consults or replaces
  // whatever is running on the branch.
  const cwd = await createWorktree(branch, repoCwd);
  if (!cwd) throw new Error(`Failed to resolve a worktree for "${branch}"`);
  // Config from the repo root, like every other launch: per-project
  // config is keyed by cwd hash, so the worktree resolves an empty bag.
  const stored = readConfig(repoCwd);
  const config = req.agentId ? { ...stored, agentId: req.agentId } : stored;
  return launchReviewTerminal({
    repo: repoCwd,
    branch,
    pullRequest: String(req.pr.id),
    cwd,
    cols: req.cols ?? DEFAULT_COLS,
    rows: req.rows ?? DEFAULT_ROWS,
    config,
    agent: req.agentId ? resolveAgent(config) : undefined,
    request: buildBackgroundReviewRequest(req.pr, req.instruction),
    ...(req.configDir ? { machine: { configDir: req.configDir } } : {}),
  });
}
