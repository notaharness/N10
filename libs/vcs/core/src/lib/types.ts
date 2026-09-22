export type ReviewDecision =
  | 'approved'
  | 'changes-requested'
  | 'waiting-for-author'
  | 'rejected'
  | 'no-response'
  | 'declined';

/** The blocking (non-approving, non-neutral) decisions. `rejected` is
 *  the hard no (ADO vote −10); `waiting-for-author` (ADO −5) and
 *  GitHub's `changes-requested` are the softer "not yet" — UIs color
 *  the soft ones as warnings and only `rejected` as destructive. */
export function isBlockingDecision(d: ReviewDecision): boolean {
  return (
    d === 'changes-requested' || d === 'waiting-for-author' || d === 'rejected'
  );
}
export type BuildStatusState = 'succeeded' | 'failed' | 'pending' | 'none';

/** The current user's review verdict on a PR, in ADO's vocabulary
 *  (votes 10 / 5 / −5 / −10). GitHub has a smaller one: both approve
 *  variants submit an approving review, and both wait-for-author and
 *  reject submit a changes-requested review. */
export type ReviewVerdict =
  | 'approve'
  | 'approve-with-suggestions'
  | 'wait-for-author'
  | 'reject';

export interface PullRequestReviewer {
  displayName: string;
  identifier: string;
  decision: ReviewDecision;
}

export interface PullRequestInfo {
  id: number;
  title: string;
  sourceBranch: string;
  targetBranch: string;
  url: string;
  createdByIdentifier: string;
  createdByDisplayName: string;
  isDraft?: boolean;
  reviewers?: PullRequestReviewer[];
  activeCommentCount?: number;
  buildStatus?: BuildStatusState;
  headSha?: string;
}

export type BranchPrMap = Record<string, PullRequestInfo | null>;

export interface CategorizedReviews {
  needsReview: PullRequestInfo[];
  waitingForAuthor: PullRequestInfo[];
  approvedByYou: PullRequestInfo[];
}

export interface VcsConfigField {
  key: string;
  label: string;
  masked?: boolean;
}

export interface VcsProvider {
  readonly id: string;
  readonly displayName: string;
  readonly authFields: VcsConfigField[];
  readonly projectFields: VcsConfigField[];

  /** Return vendor project config if URL matches, null otherwise */
  parseRemoteUrl(url: string): Record<string, string> | null;

  /**
   * Auto-detect additional user/project fields (e.g. username from CLI
   * auth), given the project config as it stands.
   *
   * Only blank fields are ever filled from the result, so a provider
   * that can see all of its fields are already set should return `null`
   * without doing the work. That is not a micro-optimisation: the
   * GitHub implementation asks the network who you are, this runs on
   * every repo open, and repo open is on the path to the first window.
   */
  autoDetectFields?(
    project: Record<string, string>
  ): Record<string, string> | null;

  /**
   * Forget anything cached under the current credentials.
   *
   * Called when the user changes an access token or the project
   * coordinates: every cached answer was fetched as somebody else, and
   * serving one back would make a corrected credential look like it
   * had not worked. Providers with nothing to forget omit it.
   */
  resetCaches?(): void;

  /**
   * Forget per-pull-request answers held beyond a single response, so
   * an explicit refresh actually goes and looks.
   *
   * Distinct from `resetCaches`, which throws away everything because
   * it was fetched as somebody else. This is the narrower thing a
   * refresh button means: the rows may have moved, ask again. A
   * provider that reads every row's state with the list — as the
   * GitHub search query does — has nothing to forget and omits it.
   */
  forgetPullRequestCache?(project: Record<string, string>): void;

  /** True when auth + project config have all required fields */
  isConfigured(
    auth: Record<string, string>,
    project: Record<string, string>
  ): boolean;

  /** Does identifier (from PR data) match the current user? */
  matchesUser(identifier: string, config: AppConfig): boolean;

  /** Fetch all active PRs, keyed by source branch */
  fetchPullRequests(
    auth: Record<string, string>,
    project: Record<string, string>
  ): Promise<BranchPrMap>;

  /** Web URL for a specific PR */
  getPullRequestUrl(project: Record<string, string>, prId: number): string;

  /** Return branch names (from the provided list) whose PRs have been merged */
  fetchMergedBranches?(
    auth: Record<string, string>,
    project: Record<string, string>,
    branches: string[]
  ): Promise<Set<string>>;

  /** Fetch all comment threads for a PR (inline + general) */
  fetchCommentThreads?(
    auth: Record<string, string>,
    project: Record<string, string>,
    prId: number
  ): Promise<PullRequestComments>;

  /** Reply to an existing comment thread. The thread is passed (not just
   *  the id) so providers can dispatch on `replyKind` — GitHub review
   *  threads use one mutation, GitHub issue comments (general PR
   *  comments) use another. */
  replyToThread?(
    auth: Record<string, string>,
    project: Record<string, string>,
    prId: number,
    thread: RemoteCommentThread,
    body: string
  ): Promise<RemoteCommentReply>;

  /** Resolve or reopen a comment thread. Callers should check
   *  `thread.canResolve` first — for thread kinds that don't support
   *  resolution (e.g. GitHub issue comments) this call is a no-op. */
  setThreadResolved?(
    auth: Record<string, string>,
    project: Record<string, string>,
    prId: number,
    thread: RemoteCommentThread,
    resolved: boolean
  ): Promise<void>;

  /** Full PR description/body. A separate fetch because list payloads
   *  truncate (ADO caps at ~400 chars) or omit it. */
  fetchPullRequestDescription?(
    auth: Record<string, string>,
    project: Record<string, string>,
    prId: number
  ): Promise<string>;

  /** Cast the current user's review verdict on a PR. */
  submitReviewVerdict?(
    auth: Record<string, string>,
    project: Record<string, string>,
    prId: number,
    verdict: ReviewVerdict
  ): Promise<void>;
}

// ── Remote comment threads (fetched from VCS providers) ───────────

export interface RemoteCommentReply {
  id: string;
  author: string; // display name (GitHub login / ADO displayName)
  body: string;
  createdAt: string; // ISO 8601
  isMinimized?: boolean; // GitHub: minimized/hidden comments
}

export interface RemoteCommentThread {
  /**
   * The provider's own id for the thread — a GitHub `reviewThread` or
   * `IssueComment` node id, an Azure DevOps thread id. Stable, and the
   * value each provider's reply and resolve calls take, so it is also
   * what gets handed to an agent (in the plan prompt, and in a draft's
   * `threadId`) as the way to name one conversation among many.
   */
  id: string;
  file: string | null; // null = general PR comment (not file-specific)
  lineStart: number | null; // null for general comments
  lineEnd: number | null;
  side: 'LEFT' | 'RIGHT';
  isResolved: boolean;
  isOutdated: boolean; // true if code has changed since the comment
  /** Whether the backing remote type supports `setThreadResolved`.
   *  GitHub issue-comments (general PR comments) don't; review threads
   *  and all ADO threads do. UI uses this to suppress the [v]resolve
   *  hint and skip the no-op mutation. */
  canResolve: boolean;
  /** Provider-specific hint used at reply time to pick the right
   *  mutation. GitHub review threads use the thread id directly; GitHub
   *  issue comments need the PR node id as the comment subject. ADO
   *  just uses thread id. */
  replyKind?: 'github-issue-comment';
  /** For `replyKind === 'github-issue-comment'`, the GraphQL node id
   *  of the PullRequest the comment lives on (used as `subjectId` of
   *  the `addComment` mutation). Undefined for other kinds. */
  replySubjectId?: string;
  comments: RemoteCommentReply[]; // first entry = root comment, rest = replies
}

export interface PullRequestComments {
  threads: RemoteCommentThread[]; // inline diff comments grouped by thread
  generalComments: RemoteCommentThread[]; // top-level PR comments (not file-specific)
}

/** Key binding descriptor as stored in config (JSON-safe, no ink dependency) */
export interface KeyDescriptorConfig {
  input?: string;
  flags?: Record<string, boolean>;
  ctrl?: boolean;
  shift?: boolean;
  meta?: boolean;
}

/**
 * The AI agents n10 knows how to drive natively (blank / seed /
 * continue with per-agent capabilities). A hidden `test` runner exists
 * in the CLI registry for e2e tests but is intentionally NOT part of
 * this public union — it is never written to a user's config.
 */
export type AgentId = 'claude' | 'copilot' | 'codex' | 'gemini' | 'opencode';

export interface AppConfig {
  email?: string;
  prPollInterval?: number;
  /**
   * Legacy raw agent command (run via `sh -c`). Still honored: when
   * `agentId` is unset it is mapped back to a known agent, and any
   * unrecognized command routes to the hidden test runner (used by the
   * e2e harness). New configs should prefer `agentId`.
   */
  aiCommand?: string;
  /** Selected AI agent. Takes precedence over `aiCommand` when set. */
  agentId?: AgentId;
  /**
   * Claude configuration directories registered on *this machine*,
   * besides the default `~/.claude`.
   *
   * Each entry is a token, not a path: `~/.claude-work` names a
   * directory relative to whichever machine's home directory the agent
   * ends up running under, and an entry that cannot be written that
   * way stays absolute and is machine-local. `@n10/core`'s
   * `agent-config-dirs.ts` owns the rule and the resolution.
   */
  claudeConfigDirs?: string[];
  vendor?: string;
  vendorAuth: Record<string, string>;
  vendorProject: Record<string, string>;
  autoDeleteOnMerge?: boolean;
  autoRebase?: boolean;
  autoHideSidebar?: boolean;
  /** When the user presses Ctrl+Space (escape from terminal) and there
   *  are sessions in the inactive-alert queue, jump focus to the next
   *  alerting session instead of returning to the sidebar. Defaults to
   *  true; set to false to keep the original "Ctrl+Space → sidebar"
   *  behavior. */
  jumpToInactiveOnEscape?: boolean;
  /** Render the diff file list as a collapsed folder tree instead of
   *  a flat path list. Opt-in; defaults to flat for backwards compat. */
  diffFileListTree?: boolean;
  mergePollInterval?: number; // ms, default 3600000, min 300000
  editor?: string;
  worktreePath?: string;
  keybindPreset?: string;
  keybindOverrides?: Record<string, KeyDescriptorConfig[]>;
  /** Recently opened repositories, newest first. Shared naming so any
   *  n10 shell (TUI, desktop) reads and writes the same list. */
  recentRepos?: RecentRepo[];
}

/** One entry of {@link AppConfig.recentRepos}. */
export interface RecentRepo {
  /** Absolute path to the repository working directory. */
  cwd: string;
  /** ms-since-epoch of the most recent open. */
  lastOpenedAt: number;
}
