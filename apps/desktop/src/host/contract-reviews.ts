/**
 * Review requests: what the renderer sends the host to reply to a
 * thread, resolve one, launch or brief a review agent, and post the
 * agent's drafts.
 *
 * Split from `contract.ts` because it is one subject, and because that
 * file is a catalogue already.
 */

import type { SessionIncarnation } from '@n10/core';
import type {
  AgentId,
  PullRequestInfo,
  RemoteCommentThread,
} from '@n10/vcs-core';

export interface ReplyRequest {
  prId: number;
  thread: RemoteCommentThread;
  body: string;
}

export interface ResolveRequest {
  prId: number;
  thread: RemoteCommentThread;
  resolved: boolean;
}

/** Start a fresh AI review of a PR in its worktree session. */
export interface ReviewLaunchRequest {
  agentId?: AgentId;
  expected?: SessionIncarnation;
  pr: PullRequestInfo;
  /** Extra user instruction appended to the review task prompt. */
  instruction?: string;
  cols?: number;
  rows?: number;
  /** A beam peerId to launch on, or omitted for local (decisions.md
   *  D2). Only meaningful for a fresh worktree — an existing one is
   *  already qualified to whatever machine it was created on. */
  machine?: string;
  /** Set only alongside `machine`: correlates this launch's
   *  `onLaunchStep` events. Ignored for a local launch. */
  launchId?: string;
}

/**
 * Deliver a plan — the comments the user queued for this pull request,
 * already composed into one prompt — to the agent in its worktree.
 *
 * The prompt is composed in the renderer rather than here because the
 * plan pane shows the user the exact text before sending it, and
 * composing it twice is how the preview and the delivery drift apart.
 */
export interface PlanCheckoutRequest {
  pr: PullRequestInfo;
  /** Output of `composePlanPrompt` — sent verbatim. */
  prompt: string;
  /**
   * Only meaningful when an agent is already running on the branch:
   * `inject` types the plan into the conversation it is already having,
   * `new-session` restarts it seeded with the plan.
   */
  mode: 'inject' | 'new-session';
  /** Initial PTY size for a spawn — the renderer knows the pane. */
  cols?: number;
  rows?: number;
}

/** What checkout did, so the renderer can say which one happened. */
export type PlanCheckoutResult = 'injected' | 'spawned';

export interface PostDraftsRequest {
  prId: number;
  /** Subset to post; every draft when omitted. */
  ids?: string[];
  /** Required for GitHub (review API). */
  headSha?: string;
  event?: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES';
}

/** An image embedded in a comment, fetched host-side with provider auth. */
export interface CommentImagePayload {
  dataUrl: string;
  contentType: string;
  bytes: number;
}
