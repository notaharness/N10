import { keyForWorktree } from '@n10/core';
import { spawn } from 'node:child_process';
import type { SidebarItem } from '@n10/core';
import {
  getSpawnedAt,
  hasSession,
  isSessionAlive,
  stopSession,
  getItemKey,
  getPrFromItem,
  orderRunningTabs,
  openSessionMenuState,
} from '@n10/core';
import {
  canRemoveBranch,
  createWorktree,
  listAllBranches,
  listWorktrees,
  rebaseOntoMaster,
} from '@n10/worktree-manager';
import type { SidebarInputCtx } from './input-types.js';
import { resolveEditorTarget } from './editor-target.js';

/** One sidebar action. Everything it needs comes from the context. */
export type SidebarAction = (ctx: SidebarInputCtx) => void;

// ── Shared steps ─────────────────────────────────────────────────

/** Show the terminal pane, reconnect it, and hand it focus. */
function focusTerminal(ctx: SidebarInputCtx): void {
  ctx.pane.setPaneMode('terminal');
  ctx.pane.setReconnectKey((k) => k + 1);
  ctx.nav.setFocus('terminal');
}

/**
 * Open the session menu for a row whose agent is not running: pick an
 * agent and start, or (PR rows) start a review. A start already in
 * flight will move selection and focus when it completes; a second
 * menu opened now would only have its Enter swallowed by the op
 * dedup, so it is refused with feedback instead.
 */
function openSessionMenu(ctx: SidebarInputCtx, item: SidebarItem): void {
  if (ctx.asyncOps.isRunning('start-session')) {
    ctx.sessions.flashStatus('A session is already starting…');
    return;
  }
  ctx.pane.setPaneMode('confirm');
  ctx.pane.setSessionMenu(openSessionMenuState(getPrFromItem(item)));
}

/**
 * Enter/Tab on a row: into a live terminal, or into the session menu
 * for a dormant one.
 */
function enterRow(ctx: SidebarInputCtx, item: SidebarItem): void {
  // Alive, not merely present: an agent that exited keeps its entry
  // (and its final frame) in the registry, but has nothing to focus
  // into — the menu offers to start it again.
  const name = ctx.sidebar.sessionNameForTerminal;
  if (name && isSessionAlive(name)) {
    focusTerminal(ctx);
    return;
  }
  openSessionMenu(ctx, item);
}

/**
 * PTY session name for rows that can own one: a session row, or a
 * review PR that has had an agent launched on it (`running` present).
 * Null for every other row — the delete-branch and kill-agent actions
 * are no-ops on those.
 */
function sessionNameForRow(item: SidebarItem | undefined): string | null {
  if (!item) return null;
  if (item.kind === 'session') return item.session.name;
  if (item.kind === 'review-pr' && item.running != null) {
    return item.sessionName ?? null;
  }
  return null;
}

// ── Navigation ───────────────────────────────────────────────────

const navigateDown: SidebarAction = (ctx) => ctx.sidebar.moveSelection(1);
const navigateUp: SidebarAction = (ctx) => ctx.sidebar.moveSelection(-1);
const jumpNextActive: SidebarAction = (ctx) =>
  ctx.sidebar.moveSelectionToActive(1);
const jumpPrevActive: SidebarAction = (ctx) =>
  ctx.sidebar.moveSelectionToActive(-1);

// A page is half the visible pane — big enough to move fast, small
// enough to keep a couple of rows of context across the jump.
const pageStep = (ctx: Parameters<SidebarAction>[0]) =>
  Math.max(3, Math.floor(ctx.terminal.paneRows / 2));
const pageDown: SidebarAction = (ctx) =>
  ctx.sidebar.moveSelection(pageStep(ctx));
const pageUp: SidebarAction = (ctx) =>
  ctx.sidebar.moveSelection(-pageStep(ctx));

/**
 * Select the Nth running session in spawn-time order so the digit
 * matches what's shown in the SessionTabBar and the sidebar prefix,
 * then jump focus straight into the terminal.
 */
export function switchTab(ctx: SidebarInputCtx, n: number): void {
  const target = orderRunningTabs(ctx.sidebar.items, getSpawnedAt)[n - 1];
  if (!target) return;
  ctx.sidebar.selectByKey(getItemKey(target));
  // `session.running` is a snapshot from the last refreshSessions()
  // and can be stale if the PTY vanished since. Only hand focus to
  // the terminal when the registry still has an entry — otherwise
  // we'd focus an empty pane. Selection still moves, so Enter from
  // the sidebar restarts the agent.
  if (hasSession(target.session.name)) focusTerminal(ctx);
}

// ── Shell ────────────────────────────────────────────────────────

const toggleHints: SidebarAction = (ctx) => ctx.toggleHints();
const quit: SidebarAction = (ctx) => ctx.exit();

const openSettings: SidebarAction = (ctx) => {
  ctx.settings.setSettingsOpen(true);
  ctx.settings.setSettingsFieldIndex(0);
};

/** Tab: into the terminal from the sidebar, back out from the terminal. */
const focusTerminalPane: SidebarAction = (ctx) => {
  const { sidebar } = ctx;
  if (ctx.nav.focus === 'terminal') {
    ctx.nav.setFocus('sidebar');
    return;
  }
  if (ctx.nav.focus !== 'sidebar' || !sidebar.sessionNameForTerminal) return;
  if (!sidebar.selectedItem) return;
  enterRow(ctx, sidebar.selectedItem);
};

/** Enter: focus a live agent, or open the session menu for a dormant one. */
const startSession: SidebarAction = (ctx) => {
  const selectedItem = ctx.sidebar.selectedItem;
  if (!selectedItem) return;
  enterRow(ctx, selectedItem);
};

// ── Branches and sessions ────────────────────────────────────────

const checkoutBranch: SidebarAction = (ctx) => {
  void ctx.asyncOps.run('fetch-branches', async () => {
    const allBranches = await listAllBranches();
    ctx.branchPicker.setBranches(allBranches);
    ctx.branchPicker.setCreating(true);
    ctx.branchPicker.setBranchFilter('');
    ctx.branchPicker.setBranchIndex(0);
  });
};

/**
 * Decide what happens to a branch whose worktree still exists: delete
 * it outright, or route through one of the two confirmations.
 */
async function confirmOrDelete(
  ctx: SidebarInputCtx,
  sessionName: string,
  branch: string
): Promise<void> {
  const check = await canRemoveBranch(branch);
  if (!check.safe) {
    if (
      check.reason === 'not pushed to upstream' ||
      check.reason === 'uncommitted changes'
    ) {
      ctx.deleteConfirm.setConfirmDelete({
        branch,
        sessionName,
        reason: check.reason,
        mode: 'type-branch',
      });
      ctx.deleteConfirm.setConfirmInput('');
    } else {
      ctx.sessions.flashStatus(`Cannot delete: ${check.reason}`);
    }
    return;
  }
  // Branch is git-clean, but if the agent's PTY is still alive it
  // carries in-memory state (plans, prompts, tool history) that would
  // be lost. Surface a lightweight Y/N prompt so the user can't blow
  // away an active session by accident. A session whose agent already
  // exited has no live process/state to lose, so it deletes without
  // the prompt.
  if (isSessionAlive(sessionName)) {
    ctx.deleteConfirm.setConfirmDelete({
      branch,
      sessionName,
      reason: 'session is active — agent process will be killed',
      mode: 'yes-no',
    });
    ctx.deleteConfirm.setConfirmInput('');
    return;
  }
  await ctx.sessions.performDelete(sessionName, branch);
}

const deleteBranch: SidebarAction = (ctx) => {
  const sessionName = sessionNameForRow(ctx.sidebar.selectedItem);
  if (!sessionName) return;

  void ctx.asyncOps.run('check-delete', async () => {
    const worktrees = await listWorktrees();
    const wt = worktrees.find((w) => keyForWorktree(w) === sessionName);
    const branch = wt?.branch;
    if (branch) {
      await confirmOrDelete(ctx, sessionName, branch);
      return;
    }
    stopSession(sessionName);
    ctx.pane.setReconnectKey((k) => k + 1);
    await ctx.sessions.refreshSessions();
  });
};

const killAgent: SidebarAction = (ctx) => {
  const sessionName = sessionNameForRow(ctx.sidebar.selectedItem);
  if (!sessionName) return;

  void ctx.asyncOps.run('delete', async () => {
    stopSession(sessionName);
    await ctx.sessions.refreshSessions();
  });
  ctx.pane.setReconnectKey((k) => k + 1);
};

// ── Remote state ─────────────────────────────────────────────────

/** Loading state for both of these is shown by the top-right spinner. */
const refreshPr: SidebarAction = (ctx) => {
  void ctx.asyncOps.run('refresh-pr', async () => {
    await ctx.sessions.refreshPr();
  });
};

const syncOrigin: SidebarAction = (ctx) => {
  void ctx.asyncOps.run('sync', async () => {
    await ctx.sessions.triggerSync();
  });
};

const rebase: SidebarAction = (ctx) => {
  const selectedItem = ctx.sidebar.selectedItem;
  if (selectedItem?.kind !== 'session') return;

  const sessionName = selectedItem.session.name;
  void ctx.asyncOps.run('rebase', async () => {
    const worktrees = await listWorktrees();
    const wt = worktrees.find((w) => keyForWorktree(w) === sessionName);
    if (!wt) {
      ctx.sessions.flashStatus('No worktree found for selected session');
      return;
    }
    // No "Updating from origin…" flash — the 'rebase' spinner
    // (label: "Rebasing") already communicates that we're working.
    const rebaseMessages = {
      success: 'Rebased onto origin successfully',
      conflict: 'Conflicts detected — rebase aborted',
      error: 'Failed to fetch from origin',
    } as const;
    ctx.sessions.flashStatus(rebaseMessages[await rebaseOntoMaster(wt.path)]);
  });
};

// ── Panes ────────────────────────────────────────────────────────

/**
 * Also works on PR rows; the worktree is checked out on demand so
 * Shift+E doesn't require pressing 'c' first.
 */
const openEditor: SidebarAction = (ctx) => {
  const item = ctx.sidebar.selectedItem;
  if (!item) return;

  void ctx.asyncOps.run('open-editor', async () => {
    const wtPath = await resolveEditorTarget(item, {
      listWorktrees,
      createWorktree,
    });
    if (!wtPath) {
      ctx.sessions.flashStatus('No worktree found for selected session');
      return;
    }
    if (item.kind !== 'session') {
      await ctx.sessions.refreshSessions();
    }
    const editor =
      ctx.config.config.editor || process.env.VISUAL || process.env.EDITOR;
    if (!editor) {
      ctx.sessions.flashStatus('No editor configured — set one in settings');
      return;
    }
    spawn(editor, [wtPath], { detached: true, stdio: 'ignore' }).unref();
    ctx.sessions.flashStatus(`Opened in ${editor}`);
  });
};

const viewDiff: SidebarAction = (ctx) => {
  const selectedItem = ctx.sidebar.selectedItem;
  if (!selectedItem || !getPrFromItem(selectedItem)) return;
  ctx.pane.setPaneMode('diff');
  ctx.pane.setDiffFileIndex(0);
};

const viewComments: SidebarAction = (ctx) => {
  const selectedItem = ctx.sidebar.selectedItem;
  if (!selectedItem || !getPrFromItem(selectedItem)) return;
  ctx.pane.setPaneMode('comments');
  ctx.pane.setGeneralCommentsIndex(0);
  ctx.pane.setGeneralCommentsScrollOffset(0);
};

// ── Catalog ──────────────────────────────────────────────────────

/**
 * Every sidebar action, by the ID the keybinding registry resolves to.
 * Guards on the current selection live at the top of the action they
 * guard, so an action the selection can't service is a no-op.
 */
export const SIDEBAR_ACTIONS: Record<string, SidebarAction> = {
  'sidebar.navigate-down': navigateDown,
  'sidebar.navigate-up': navigateUp,
  'sidebar.jump-next-active': jumpNextActive,
  'sidebar.jump-prev-active': jumpPrevActive,
  'sidebar.page-down': pageDown,
  'sidebar.page-up': pageUp,
  'sidebar.toggle-hints': toggleHints,
  'sidebar.quit': quit,
  'sidebar.open-settings': openSettings,
  'sidebar.focus-terminal': focusTerminalPane,
  'sidebar.start-session': startSession,
  'sidebar.checkout-branch': checkoutBranch,
  'sidebar.delete-branch': deleteBranch,
  'sidebar.kill-agent': killAgent,
  'sidebar.refresh-pr': refreshPr,
  'sidebar.sync-origin': syncOrigin,
  'sidebar.rebase': rebase,
  'sidebar.open-editor': openEditor,
  'sidebar.view-diff': viewDiff,
  'sidebar.view-comments': viewComments,
};
