/**
 * Typed contract between the Electron main process and the renderer.
 *
 * The preload script exposes exactly this shape as `window.n10` via
 * contextBridge; the main process implements it behind ipcMain
 * handlers. Both sides import these types from this file so the
 * compiler keeps the bridge honest.
 *
 * Process model: the renderer is sandboxed (no Node). All filesystem,
 * git, and VCS-provider work happens in the main process through the
 * existing @n10 libs. The host holds one "active repo" — desktop is
 * single-repo-per-window, matching how the CLI runs inside a repo.
 */

import type { AgentId, ReviewVerdict } from '@n10/vcs-core';
export type { AgentId, ReviewVerdict };
import type {
  SessionLaunchContext,
  SessionIncarnation,
  BabysitStatus,
  LaunchIntent,
  SidebarItem,
} from '@n10/core';
import type { CommentSeverity, ReviewComment } from '@n10/review-comments';
export type { CommentSeverity, ReviewComment };
import type { WorktreeInfo } from '@n10/worktree-manager';
import type {
  BranchPrMap,
  PullRequestComments,
  RemoteCommentReply,
  RemoteCommentThread,
} from '@n10/vcs-core';
export type {
  BranchPrMap,
  PullRequestComments,
  RemoteCommentReply,
  RemoteCommentThread,
};
export type { BabysitStatus, PullRequestLookup, SidebarItem } from '@n10/core';

// The push half of the contract — channel names and their payloads.
export * from './contract-events.js';
// Machines: other n10 hosts paired over beam, and this one's own
// identity and accept-connections state.
export type * from './contract-machines.js';
import type {
  AcceptingStatus,
  MachineView,
  PairConfirmResult,
  PairPreviewResult,
} from './contract-machines.js';
// Terminal tabs — sessions bound to a directory rather than a worktree.
export type * from './contract-terminals.js';
import type {
  TerminalLaunchRequest,
  TerminalSummary,
} from './contract-terminals.js';
// Agent sessions as the renderer lists them — the open repository's,
// and those alive in other repositories.
export type * from './contract-sessions.js';
import type {
  ForeignSessionSummary,
  SessionSummary,
} from './contract-sessions.js';
// Review requests — replies, resolutions, review launches, drafts.
export type * from './contract-reviews.js';
import type {
  CommentImagePayload,
  PlanCheckoutRequest,
  PlanCheckoutResult,
  PostDraftsRequest,
  ReplyRequest,
  ResolveRequest,
  ReviewLaunchRequest,
} from './contract-reviews.js';
import type {
  BabysitChangedEvent,
  LaunchStepEvent,
  MachinesChangedEvent,
  MenuCommandEvent,
  SessionDataEvent,
  SessionExitEvent,
  SyncNoticeEvent,
} from './contract-events.js';

export interface N10VersionInfo {
  /** n10-desktop package version */
  app: string;
  electron: string;
  node: string;
  chrome: string;
}

// ── Repo ─────────────────────────────────────────────────────────

export interface RepoInfo {
  cwd: string;
  providerId: string | null;
  vcsConfigured: boolean;
}

// ── Sessions (agent terminals) ───────────────────────────────────

export type { SessionIncarnation };
export interface SessionLaunchView extends SessionLaunchContext {
  defaultAgentName: string;
}

export interface SessionLaunchRequest {
  fresh?: boolean;
  expected?: SessionIncarnation;
  branch: string;
  intent: LaunchIntent;
  /**
   * Explicit agent for this launch. With a blank intent, an unset agent
   * uses the configured default (including custom commands). Continuation
   * without an override uses the agent recorded on a retained session.
   */
  agentId?: AgentId;
  prompt?: string;
  /** Delivered as a native system prompt for agents that support it. */
  systemGuidance?: string;
  /** Initial PTY size — the renderer knows the real pane geometry. */
  cols?: number;
  rows?: number;
  /** A beam peerId to launch on, or omitted for local (decisions.md
   *  D2). Only meaningful for a fresh worktree session — an existing
   *  one is already qualified to whatever machine it was created on. */
  machine?: string;
  /** Set only alongside `machine`: correlates this launch's
   *  `onLaunchStep` events, so a second concurrent launch — or a retry
   *  — never shows the wrong one's progress. Ignored for a local
   *  launch, which emits no steps. */
  launchId?: string;
}

/**
 * One row of the session menu's agent picker. The configured agent
 * comes first, labelled as the default; `id` is the registry id, or
 * `'test'` for a custom `aiCommand`, which only ever appears in that
 * first row.
 */
export interface AgentOptionView {
  id: AgentId | 'test';
  name: string;
}

/** Snapshot of a session's recent output (host-side ring buffer). */
export interface SessionBuffer {
  data: string;
  /** seq of the last chunk included in `data`. */
  seq: number;
}

// ── Settings ─────────────────────────────────────────────────────

export type SettingsGroup =
  | 'general'
  | 'agent'
  | 'sync'
  | 'terminal'
  | 'provider';

/** Stand-in the host sends instead of a stored secret. Sending it back
 *  unchanged is a no-op write, so the real credential never has to
 *  leave the main process for the settings form to work. */
export const SECRET_PLACEHOLDER = '••••••••';

/** One row of the settings form: the field plus its current value. */
export interface SettingsFieldView {
  label: string;
  key: string;
  masked?: boolean;
  description?: string;
  presets?: { name: string; value: string | null }[];
  value: string;
  /** The value in force while `value` is empty, when the host decides
   *  it at read time (the terminal backend resolves from the tmux
   *  probe). The page shows that preset, marked as the default. */
  defaultValue?: string;
  /** Section the desktop settings page files this field under. */
  group: SettingsGroup;
  /** Widget hint derived from the presets shape. */
  kind: 'boolean' | 'select' | 'text';
  /** When set, the control is not editable right now — the string is
   *  the human-readable reason (shown next to the description). */
  disabled?: string;
}

// ── Recent repos ─────────────────────────────────────────────────

export interface RecentRepoEntry {
  cwd: string;
  lastOpenedAt: number;
  /** Re-validated against the filesystem at list time. */
  valid: boolean;
}

// ── Sync (remote PR data) ────────────────────────────────────────

/**
 * The sidebar as the host answers it, together with the repository it
 * describes.
 *
 * The host holds one repository and answers for whichever one that is;
 * the renderer keys the answer by the repository *it* has open. The
 * two disagree while a switch is in flight — the host has moved on and
 * the previous workspace is still mounted and polling — and without
 * the stamp an answer about the new repository lands in the old one's
 * cache and is reconciled into its tabs.
 */
export interface SidebarModel {
  cwd: string;
  items: SidebarItem[];
}

export interface SyncState {
  providerId: string | null;
  providerConfigured: boolean;
  /** ms-epoch of the last successful remote fetch, null if never. */
  lastRemoteSyncAt: number | null;
  /** ms-epoch of the last git sync pass (fetch + ff main), null if never. */
  lastGitSyncAt: number | null;
  remoteError: string | null;
  remoteSyncing: boolean;
  /** Remote cache TTL in ms (from config, clamped). */
  remoteIntervalMs: number;
  /**
   * Provider fetches this process has started, successful or not.
   *
   * Monotonic and diagnostic: it is how "did that actually go and
   * ask?" gets a yes or no. A test — or a curious user reading the
   * sync popover — cannot tell a refetch from a cache hit by watching
   * `lastRemoteSyncAt`, which only moves when a fetch succeeds.
   */
  remoteFetches: number;
}

// ── Desktop shell (native menus, prefs) ──────────────────────────

export type ThemePreference = 'system' | 'light' | 'dark';

export interface DesktopPrefs {
  theme: ThemePreference;
  /** Use the OS window frame + native menu bar instead of the custom
   *  title bar. Applied on next launch. */
  nativeFrame: boolean;
}

/** One entry of a native context menu. */
export type ContextMenuItem =
  | { type: 'separator' }
  | {
      id: string;
      label: string;
      enabled?: boolean;
      /** Render as a destructive action where the platform supports it. */
      danger?: boolean;
    };

/** Mirror of app-core's ActivitySnapshot, redeclared so the renderer
 *  contract stays free of app-core imports. */
export interface SessionActivitySnapshot {
  active: boolean;
  flashing: boolean;
  exited?: boolean;
}

/** The API surface exposed on `window.n10`. */
export interface N10HostApi {
  getVersion(): Promise<N10VersionInfo>;

  // ── Repo ─────────────────────────────────────────────────────
  /** Validate + open a directory as the active repo. */
  openRepo(cwd: string): Promise<RepoInfo>;
  getRepo(): Promise<RepoInfo | null>;

  // ── Recent repos ─────────────────────────────────────────────
  listRecentRepos(): Promise<RecentRepoEntry[]>;
  /** Native folder picker. Resolves to the chosen path, or null when
   *  the user cancels. */
  selectRepoDirectory(): Promise<string | null>;
  /** The same picker, for any folder — a terminal's directory need not
   *  be a repository. */
  selectFolder(): Promise<string | null>;
  forgetRecent(cwd: string): Promise<void>;

  // ── Config / settings ────────────────────────────────────────
  // NOTE: there is deliberately no `getConfig` on this bridge. It
  // returned the whole AppConfig — provider PAT and token included — to
  // a renderer that displays remote content. Settings are edited
  // through the masked `SettingsFieldView` instead.
  /** Settings form model: every editable field with its current
   *  resolved display value (same semantics as the CLI's panel). */
  getSettingsView(): Promise<SettingsFieldView[]>;
  /** Update one settings field (same bag semantics as the CLI). */
  updateSettingsField(
    ref: { label: string; key: string },
    value: string
  ): Promise<void>;

  // ── Sidebar (unified worktrees + PRs + reviews, TUI order) ────
  /** The sidebar of the open repository, stamped with which one that
   *  is — see `SidebarModel`. */
  getSidebarModel(): Promise<SidebarModel>;
  getSyncState(): Promise<SyncState>;
  /** Drop the remote PR cache and re-fetch now. */
  refreshRemote(): Promise<void>;

  // ── Worktrees ────────────────────────────────────────────────
  listWorktrees(): Promise<WorktreeInfo[]>;
  listBranches(): Promise<string[]>;
  /** All local + remote branch names (checkout candidates). */
  listAllBranches(): Promise<string[]>;
  createWorktree(branch: string): Promise<string | null>;
  removeWorktree(branch: string, force: boolean): Promise<boolean>;
  canRemoveBranch(
    branch: string
  ): Promise<{ safe: true } | { safe: false; reason: string }>;
  /** Open the branch's worktree in the configured external editor
   *  (config.editor, falling back to $VISUAL / $EDITOR — same as the
   *  TUI). Creates the worktree if needed. Resolves to the editor
   *  command used. */
  openInEditor(branch: string): Promise<{ editor: string }>;

  // ── Reviews ──────────────────────────────────────────────────
  fetchPullRequests(): Promise<BranchPrMap>;
  fetchCommentThreads(prId: number): Promise<PullRequestComments>;
  replyToThread(req: ReplyRequest): Promise<void>;
  setThreadResolved(req: ResolveRequest): Promise<void>;
  /** Full PR description (list payloads truncate or omit it). */
  fetchPrDescription(prId: number): Promise<string>;
  /** Cast the current user's review verdict on a PR. */
  submitReviewVerdict(prId: number, verdict: ReviewVerdict): Promise<void>;
  /** The reviewer-list identifier of the authenticated user (GitHub
   *  login / ADO email), for optimistic reviewer patches. */
  getReviewViewer(): Promise<{ identifier: string } | null>;
  /** Download a comment image with the provider's credentials (Azure
   *  DevOps PAT / GitHub token) and return it as a data URL. */
  fetchCommentImage(url: string): Promise<CommentImagePayload | null>;

  // ── Draft review comments (from the review agent) ─────────────
  listDraftComments(prId: number): Promise<ReviewComment[]>;
  updateDraftComment(
    prId: number,
    id: string,
    patch: Partial<Pick<ReviewComment, 'body' | 'severity'>>
  ): Promise<void>;
  deleteDraftComment(prId: number, id: string): Promise<void>;
  /** Resolves to the number of comments posted. */
  postDraftComments(req: PostDraftsRequest): Promise<number>;

  // ── Sessions ─────────────────────────────────────────────────
  launchAgent(req: SessionLaunchRequest): Promise<{ name: string }>;
  /** Create the PR's worktree if needed and start/continue a review
   *  session seeded with the shared review prompt + guidance. */
  launchReviewAgent(req: ReviewLaunchRequest): Promise<{ name: string }>;
  /** The agents the session menu offers, configured default first. */
  listAgentOptions(): Promise<AgentOptionView[]>;
  getSessionLaunchContext(branch: string): Promise<SessionLaunchView>;
  /** Send a composed plan to the PR's agent, creating the worktree and
   *  starting one when there is none. Rejects with the reason on
   *  failure, leaving the plan intact for a retry. */
  checkoutPlan(req: PlanCheckoutRequest): Promise<PlanCheckoutResult>;
  listSessions(): Promise<SessionSummary[]>;
  /** Agents alive in other repositories, for the tab strip to give
   *  each a tab in its own group. The open repository's own are left
   *  out — the sidebar describes those. */
  listForeignSessions(): Promise<ForeignSessionSummary[]>;
  /** Debounced per-session agent activity (same registry as the TUI's
   *  sidebar spinner): `active` = producing output now, `flashing` =
   *  went idle after a real work streak and the user hasn't looked. */
  getSessionActivity(): Promise<Record<string, SessionActivitySnapshot>>;
  /** The user is looking at this session — clears its flashing state. */
  markSessionSeen(name: string): Promise<void>;
  /** Recent output for a session so a (re)mounted terminal can replay
   *  what it missed before subscribing to live data. */
  getSessionBuffer(name: string): Promise<SessionBuffer>;
  writeSession(name: string, data: string): Promise<void>;
  resizeSession(name: string, cols: number, rows: number): Promise<void>;
  killSession(name: string): Promise<void>;
  /** Manual retry after Phase 5's bounded automatic reconnect (3
   *  attempts) gives up and `connectionState` reads `failed` — the
   *  pane's `Reconnect` action. A no-op for a session whose backend has
   *  no manual retry (a local session, or one already connected). */
  reconnectSession(name: string): Promise<void>;
  /** Write an image pasted into a terminal to a temp file and return
   *  its path, which is how a terminal agent can be given a picture —
   *  a PTY carries text, not bytes. Rejects anything that is not a
   *  recognised image type. */
  saveClipboardImage(data: Uint8Array, mimeType: string): Promise<string>;
  // ── Terminal tabs ────────────────────────────────────────────
  /** Open a shell or an agent in a directory. The summary says which
   *  repository the tab belongs to, if any. */
  launchTerminal(req: TerminalLaunchRequest): Promise<TerminalSummary>;
  /** Every terminal this host holds, whatever repository is open —
   *  terminals belong to directories, not to the open repo. */
  listTerminals(): Promise<TerminalSummary[]>;
  /** Kill the terminal's session, on either backend, and forget it. */
  killTerminal(name: string): Promise<void>;
  /** Subscribe to PTY output. Returns an unsubscribe function. */
  onSessionData(cb: (payload: SessionDataEvent) => void): () => void;
  onSessionExit(cb: (payload: SessionExitEvent) => void): () => void;
  /** Named launch progress for a remote launch (ux-machines.md §5) —
   *  filter by the request's own `launchId`. Never fires for a local
   *  launch. */
  onLaunchStep(cb: (payload: LaunchStepEvent) => void): () => void;

  // ── Diff ─────────────────────────────────────────────────────
  fetchDiffText(sourceBranch: string, targetBranch: string): Promise<string>;
  /** Diff of a branch's worktree against its base including uncommitted
   *  and untracked work — what an agent has done so far, as opposed to
   *  what it has committed. Empty string when the branch has no
   *  worktree. */
  fetchWorktreeDiffText(branch: string, targetBranch: string): Promise<string>;
  fetchFileDiffText(
    sourceBranch: string,
    targetBranch: string,
    file: string
  ): Promise<string>;

  // ── Shell ────────────────────────────────────────────────────
  /** Open a URL in the user's default browser. */
  openExternal(url: string): Promise<void>;
  /** Show a native context menu at the cursor; resolves to the chosen
   *  item id, or null when dismissed. */
  showContextMenu(items: ContextMenuItem[]): Promise<string | null>;
  /** Pop the application menu (used by the custom title bar's menu
   *  button on platforms without a visible native menu bar). */
  showAppMenu(): Promise<void>;
  /** Subscribe to native menu commands. Returns an unsubscribe fn. */
  onMenuCommand(cb: (payload: MenuCommandEvent) => void): () => void;
  /** Toast-worthy events from the host's remote sync loop. */
  onSyncNotice(cb: (notice: SyncNoticeEvent) => void): () => void;
  /** Fires when a background remote fetch has changed the sidebar
   *  model. Carries no payload — the renderer refetches. */
  onRemoteUpdated(cb: () => void): () => void;
  /** Fires when a worktree or agent session created outside this
   *  process appeared or went away. Carries no payload — the renderer
   *  refetches. */
  onDiscoveryChanged(cb: () => void): () => void;

  // ── Machines (beam peers) ───────────────────────────────────
  /** Every machine: the local one first, then paired peers. Repo
   *  independent — like `listTerminals`, this answers the same
   *  whatever repository (if any) is open. */
  listMachines(): Promise<MachineView[]>;
  getAcceptingStatus(): Promise<AcceptingStatus>;
  /** Turn accepting on or off. Off does not drop existing connections. */
  setAccepting(enabled: boolean): Promise<AcceptingStatus>;
  /** A fresh pairing token/URL — the running one's TTL expired. */
  regeneratePairingUrl(): Promise<AcceptingStatus>;
  /** Step 1 of pairing: fetch the descriptor a URL names, without
   *  spending its token or storing anything. */
  previewPairing(url: string): Promise<PairPreviewResult>;
  /** Step 2: spend the token and store the peer. `force` replaces an
   *  existing peer's key on a `key-mismatch` failure. */
  confirmPairing(url: string, force?: boolean): Promise<PairConfirmResult>;
  /** Local-only: the name this machine goes by here. Works for the
   *  local row (renames this machine's own identity) or a peer. */
  renameMachine(peerId: string, label: string): Promise<MachineView>;
  /** Kept, but refused from now on. The other machine's sessions keep
   *  running. */
  revokeMachine(peerId: string): Promise<MachineView>;
  /** Forgets the peer entirely (not just revoked). */
  forgetMachine(peerId: string): Promise<void>;
  onMachinesChanged(cb: (machines: MachinesChangedEvent) => void): () => void;

  // ── Babysitting ──────────────────────────────────────────────
  /** Watch a pull request and brief its agent — CI, unresolved review
   *  threads, conflicts — once the news has settled and the agent is
   *  idle. Rejects when the pull request is not in the sidebar. */
  startBabysit(prId: number): Promise<BabysitStatus>;
  stopBabysit(prId: number): Promise<void>;
  /** Fires when a babysitter started an agent or ended. Its status
   *  otherwise travels on the sidebar item (`SidebarItem.babysit`). */
  onBabysitChanged(cb: (event: BabysitChangedEvent) => void): () => void;
  getDesktopPrefs(): Promise<DesktopPrefs>;
  setDesktopPrefs(patch: Partial<DesktopPrefs>): Promise<DesktopPrefs>;
  /** Native about box. */
  showAbout(): Promise<void>;
}

/** IPC channel names — single source of truth for main and preload. */
export const IPC = {
  getVersion: 'n10/version',
  openRepo: 'n10/repo/open',
  listRecentRepos: 'n10/repo/recents',
  selectRepoDirectory: 'n10/repo/select-directory',
  selectFolder: 'n10/shell/select-folder',
  forgetRecent: 'n10/repo/forget',
  getRepo: 'n10/repo/get',
  getSettingsView: 'n10/settings/view',
  updateSettingsField: 'n10/config/update-field',
  getSidebarModel: 'n10/sidebar/model',
  getSyncState: 'n10/sidebar/sync-state',
  refreshRemote: 'n10/sidebar/refresh-remote',
  listWorktrees: 'n10/worktree/list',
  listBranches: 'n10/worktree/branches',
  listAllBranches: 'n10/worktree/all-branches',
  createWorktree: 'n10/worktree/create',
  removeWorktree: 'n10/worktree/remove',
  canRemoveBranch: 'n10/worktree/can-remove',
  openInEditor: 'n10/worktree/open-in-editor',
  launchAgent: 'n10/session/launch',
  listSessions: 'n10/session/list',
  listForeignSessions: 'n10/session/list-foreign',
  getSessionActivity: 'n10/session/activity',
  markSessionSeen: 'n10/session/seen',
  getSessionBuffer: 'n10/session/buffer',
  writeSession: 'n10/session/write',
  resizeSession: 'n10/session/resize',
  killSession: 'n10/session/kill',
  reconnectSession: 'n10/session/reconnect',
  saveClipboardImage: 'n10/session/clipboard-image',
  launchTerminal: 'n10/terminal/launch',
  listTerminals: 'n10/terminal/list',
  killTerminal: 'n10/terminal/kill',
  fetchPullRequests: 'n10/reviews/prs',
  fetchCommentThreads: 'n10/reviews/comments',
  replyToThread: 'n10/reviews/reply',
  setThreadResolved: 'n10/reviews/resolve',
  fetchPrDescription: 'n10/reviews/pr-description',
  submitReviewVerdict: 'n10/reviews/submit-verdict',
  getReviewViewer: 'n10/reviews/viewer',
  fetchCommentImage: 'n10/reviews/comment-image',
  listDraftComments: 'n10/drafts/list',
  updateDraftComment: 'n10/drafts/update',
  deleteDraftComment: 'n10/drafts/delete',
  postDraftComments: 'n10/drafts/post',
  launchReviewAgent: 'n10/session/launch-review',
  listAgentOptions: 'n10/session/agent-options',
  getSessionLaunchContext: 'n10/session/launch-context',
  checkoutPlan: 'n10/session/checkout-plan',
  fetchDiffText: 'n10/diff/text',
  fetchWorktreeDiffText: 'n10/diff/worktree-text',
  fetchFileDiffText: 'n10/diff/file-text',
  openExternal: 'n10/shell/open-external',
  showContextMenu: 'n10/shell/context-menu',
  showAppMenu: 'n10/shell/app-menu',
  getDesktopPrefs: 'n10/shell/prefs/get',
  setDesktopPrefs: 'n10/shell/prefs/set',
  showAbout: 'n10/shell/about',
  startBabysit: 'n10/babysit/start',
  stopBabysit: 'n10/babysit/stop',
  listMachines: 'n10/machines/list',
  getAcceptingStatus: 'n10/machines/accepting-status',
  setAccepting: 'n10/machines/set-accepting',
  regeneratePairingUrl: 'n10/machines/regenerate-pairing-url',
  previewPairing: 'n10/machines/preview-pairing',
  confirmPairing: 'n10/machines/confirm-pairing',
  renameMachine: 'n10/machines/rename',
  revokeMachine: 'n10/machines/revoke',
  forgetMachine: 'n10/machines/forget',
} as const;

/** Error thrown by host handlers when no repo has been opened yet. */
export class NoActiveRepoError extends Error {
  constructor() {
    super('No repository is open');
    this.name = 'NoActiveRepoError';
  }
}
