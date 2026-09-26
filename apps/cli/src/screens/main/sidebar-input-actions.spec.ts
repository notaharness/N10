import { worktreeSessionKey } from '@n10/core';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type * as WorktreeManagerModule from '@n10/worktree-manager';
import type { WorktreeInfo } from '@n10/worktree-manager';
import type { PullRequestInfo } from '@n10/vcs-core';
import {
  ACTIONS,
  NORMIE_PRESET,
  resolveAction,
  type KeyPress,
  type SidebarItem,
} from '@n10/core';
import type { SidebarInputCtx } from './input-types.js';

// Characterization suite for handleSidebarInput's action dispatch.
//
// sidebar-input.spec.ts already pins the `sidebar.switch-tab-N`
// branch (spawn ordering, stale-PTY gating) and is left alone; this
// file covers the other 17 sidebar actions, which had no unit
// coverage at all before the if-chain became a dispatch table.
//
// Like diff-viewer-input.spec.ts, resolution runs through the real
// Normie preset rather than passing action IDs in, so a moved binding
// breaks these tests.

let liveSessions = new Set<string>();
/** Sessions whose agent exited: still in the registry, no longer alive. */
let exitedSessions = new Set<string>();
const killSessionMock = vi.fn();

vi.mock('@n10/core', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getSpawnedAt: (name: string) => (liveSessions.has(name) ? 1 : undefined),
  hasSession: (name: string) =>
    liveSessions.has(name) || exitedSessions.has(name),
  isSessionAlive: (name: string) => liveSessions.has(name),
  stopSession: (name: string) => killSessionMock(name),
}));

vi.mock('@n10/worktree-manager', async (importOriginal) => ({
  ...(await importOriginal<typeof WorktreeManagerModule>()),
  listWorktrees: vi.fn(),
  listAllBranches: vi.fn(),
  canRemoveBranch: vi.fn(),
  createWorktree: vi.fn(),
  rebaseOntoMaster: vi.fn(),
}));

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  spawn: vi.fn(),
}));

import { spawn } from 'node:child_process';
import {
  canRemoveBranch,
  createWorktree,
  listAllBranches,
  listWorktrees,
  rebaseOntoMaster,
} from '@n10/worktree-manager';
import { handleSidebarInput } from './sidebar-input.js';

// ── Fixtures ─────────────────────────────────────────────────────

function makeKey(overrides: Partial<KeyPress> = {}): KeyPress {
  return {
    upArrow: false,
    downArrow: false,
    leftArrow: false,
    rightArrow: false,
    return: false,
    escape: false,
    tab: false,
    backspace: false,
    delete: false,
    pageDown: false,
    pageUp: false,
    home: false,
    end: false,
    ctrl: false,
    shift: false,
    meta: false,
    super: false,
    hyper: false,
    capsLock: false,
    numLock: false,
    ...overrides,
  };
}

// Normie bindings for the sidebar context, by action.
const KEYS = {
  toggleHints: () => ['?', makeKey()] as const,
  focusTerminal: () => ['', makeKey({ tab: true })] as const,
  quit: () => ['q', makeKey()] as const,
  checkoutBranch: () => ['c', makeKey()] as const,
  deleteBranch: () => ['', makeKey({ delete: true })] as const,
  killAgent: () => ['K', makeKey({ shift: true })] as const,
  openSettings: () => ['s', makeKey()] as const,
  refreshPr: () => ['r', makeKey()] as const,
  rebase: () => ['u', makeKey()] as const,
  openEditor: () => ['E', makeKey({ shift: true })] as const,
  syncOrigin: () => ['f', makeKey()] as const,
  viewDiff: () => ['d', makeKey()] as const,
  viewComments: () => ['C', makeKey({ shift: true })] as const,
  startSession: () => ['', makeKey({ return: true })] as const,
  navigateDown: () => ['', makeKey({ downArrow: true })] as const,
  navigateUp: () => ['', makeKey({ upArrow: true })] as const,
  jumpNextActive: () =>
    ['', makeKey({ downArrow: true, shift: true })] as const,
  jumpPrevActive: () => ['', makeKey({ upArrow: true, shift: true })] as const,
} satisfies Record<string, () => readonly [string, KeyPress]>;

function makePr(overrides: Partial<PullRequestInfo> = {}): PullRequestInfo {
  return {
    id: 7,
    title: 'a pr',
    sourceBranch: 'feat/thing',
    targetBranch: 'master',
    url: '',
    createdByIdentifier: '',
    createdByDisplayName: '',
    ...overrides,
  } as PullRequestInfo;
}

function sessionItem(
  path: string,
  extra: { pr?: PullRequestInfo; running?: boolean } = {}
): SidebarItem {
  return {
    kind: 'session',
    session: { name: worktreeSessionKey(path), running: extra.running ?? true },
    isMerged: false,
    ...(extra.pr ? { pr: extra.pr } : {}),
  } as SidebarItem;
}

/** The session of the checkout `makePr()`'s branch is in. */
const PR_SESSION = worktreeSessionKey('/wt/feat-thing');

/** A PR row that has had a session (`running` set) carries the name
 *  of the checkout's session, as `buildSidebarItems` attaches it. */
function prSessionFields(running?: boolean) {
  return running === undefined ? {} : { running, sessionName: PR_SESSION };
}

function reviewPrItem(pr: PullRequestInfo, running?: boolean): SidebarItem {
  return {
    kind: 'review-pr',
    pr,
    category: 'needs-review',
    ...prSessionFields(running),
  } as SidebarItem;
}

function orphanPrItem(pr: PullRequestInfo, running?: boolean): SidebarItem {
  return {
    kind: 'orphan-pr',
    pr,
    ...prSessionFields(running),
  } as SidebarItem;
}

function worktree(path: string, branch: string): WorktreeInfo {
  return { path, branch, bare: false };
}

interface CtxOpts {
  selectedItem?: SidebarItem;
  sessionNameForTerminal?: string | null;
  focus?: 'sidebar' | 'terminal';
  editor?: string;
}

function makeCtx(opts: CtxOpts = {}) {
  // asyncOps.run is synchronous here: it invokes the operation
  // immediately and records the promise so tests can await it.
  const runCalls: { name: string; done: Promise<void> }[] = [];
  const asyncOps = {
    run: vi.fn((name: string, fn: () => Promise<void>) => {
      const done = fn();
      runCalls.push({ name, done });
      return done;
    }),
    isRunning: vi.fn(() => false),
    inFlight: new Set<string>(),
  };
  const settle = () => Promise.all(runCalls.map((c) => c.done));

  const sidebar = {
    items: opts.selectedItem ? [opts.selectedItem] : [],
    selectedIndex: 0,
    selectedItem: opts.selectedItem,
    selectedPr: undefined,
    sessionNameForTerminal: opts.sessionNameForTerminal ?? null,
    totalItems: opts.selectedItem ? 1 : 0,
    selectByKey: vi.fn(),
    moveSelection: vi.fn(),
    moveSelectionToActive: vi.fn(),
  };
  const pane = {
    setPaneMode: vi.fn(),
    setReconnectKey: vi.fn(),
    setSessionMenu: vi.fn(),
    setDiffFileIndex: vi.fn(),
    setGeneralCommentsIndex: vi.fn(),
    setGeneralCommentsScrollOffset: vi.fn(),
  };
  const nav = { focus: opts.focus ?? 'sidebar', setFocus: vi.fn() };
  const sessions = {
    flashStatus: vi.fn(),
    refreshSessions: vi.fn().mockResolvedValue([]),
    performDelete: vi.fn().mockResolvedValue(undefined),
    refreshPr: vi.fn().mockResolvedValue(undefined),
    triggerSync: vi.fn().mockResolvedValue(undefined),
  };
  const branchPicker = {
    setBranches: vi.fn(),
    setCreating: vi.fn(),
    setBranchFilter: vi.fn(),
    setBranchIndex: vi.fn(),
  };
  const deleteConfirm = {
    setConfirmDelete: vi.fn(),
    setConfirmInput: vi.fn(),
  };
  const settings = {
    setSettingsOpen: vi.fn(),
    setSettingsFieldIndex: vi.fn(),
  };
  const config = { config: { editor: opts.editor } };
  const toggleHints = vi.fn();
  const exit = vi.fn();

  const ctx = {
    sidebar,
    pane,
    nav,
    sessions,
    branchPicker,
    deleteConfirm,
    settings,
    asyncOps,
    config,
    terminal: { paneCols: 80, paneRows: 24 },
    keybinds: {
      resolve: (input: string, key: KeyPress, context: 'sidebar') =>
        resolveAction(input, key, context, NORMIE_PRESET.bindings, ACTIONS),
    },
    toggleHints,
    exit,
  } as unknown as SidebarInputCtx;

  return {
    ctx,
    sidebar,
    pane,
    nav,
    sessions,
    branchPicker,
    deleteConfirm,
    settings,
    asyncOps,
    toggleHints,
    exit,
    settle,
  };
}

/** Drive the handler with one of the Normie bindings above. */
function press(binding: readonly [string, KeyPress], ctx: SidebarInputCtx) {
  handleSidebarInput(binding[0], binding[1], ctx);
}

beforeEach(() => {
  vi.clearAllMocks();
  liveSessions = new Set();
  exitedSessions = new Set();
  vi.mocked(listWorktrees).mockResolvedValue([]);
  vi.mocked(listAllBranches).mockResolvedValue([]);
  vi.mocked(canRemoveBranch).mockResolvedValue({ safe: true });
  vi.mocked(createWorktree).mockResolvedValue(null);
  vi.mocked(rebaseOntoMaster).mockResolvedValue('success');
  vi.mocked(spawn).mockReturnValue({
    unref: vi.fn(),
  } as unknown as ReturnType<typeof spawn>);
});

// ── unbound key ──────────────────────────────────────────────────

describe('sidebar handler — unresolved key', () => {
  it('does nothing when the keypress maps to no sidebar action', () => {
    const t = makeCtx({ selectedItem: sessionItem('/wt/alpha') });

    handleSidebarInput('z', makeKey(), t.ctx);

    expect(t.asyncOps.run).not.toHaveBeenCalled();
    expect(t.pane.setPaneMode).not.toHaveBeenCalled();
    expect(t.sidebar.moveSelection).not.toHaveBeenCalled();
    expect(t.exit).not.toHaveBeenCalled();
  });
});

// ── toggle-hints / quit / open-settings ──────────────────────────

describe('sidebar handler — toggle-hints', () => {
  it('toggles hint visibility', () => {
    const t = makeCtx();
    press(KEYS.toggleHints(), t.ctx);
    expect(t.toggleHints).toHaveBeenCalledOnce();
  });
});

describe('sidebar handler — quit', () => {
  it('exits the app', () => {
    const t = makeCtx();
    press(KEYS.quit(), t.ctx);
    expect(t.exit).toHaveBeenCalledOnce();
  });
});

describe('sidebar handler — open-settings', () => {
  it('opens settings on the first field', () => {
    const t = makeCtx();
    press(KEYS.openSettings(), t.ctx);
    expect(t.settings.setSettingsOpen).toHaveBeenCalledExactlyOnceWith(true);
    expect(t.settings.setSettingsFieldIndex).toHaveBeenCalledExactlyOnceWith(0);
  });
});

// ── navigation ───────────────────────────────────────────────────

describe('sidebar handler — navigation', () => {
  it('navigate-down moves the selection forward', () => {
    const t = makeCtx();
    press(KEYS.navigateDown(), t.ctx);
    expect(t.sidebar.moveSelection).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('navigate-up moves the selection back', () => {
    const t = makeCtx();
    press(KEYS.navigateUp(), t.ctx);
    expect(t.sidebar.moveSelection).toHaveBeenCalledExactlyOnceWith(-1);
  });

  it('jump-next-active skips to the next active session', () => {
    const t = makeCtx();
    press(KEYS.jumpNextActive(), t.ctx);
    expect(t.sidebar.moveSelectionToActive).toHaveBeenCalledExactlyOnceWith(1);
    expect(t.sidebar.moveSelection).not.toHaveBeenCalled();
  });

  it('jump-prev-active skips to the previous active session', () => {
    const t = makeCtx();
    press(KEYS.jumpPrevActive(), t.ctx);
    expect(t.sidebar.moveSelectionToActive).toHaveBeenCalledExactlyOnceWith(-1);
  });
});

// ── refresh-pr / sync-origin ─────────────────────────────────────

describe('sidebar handler — refresh-pr', () => {
  it('refreshes PR data under the refresh-pr operation', async () => {
    const t = makeCtx();
    press(KEYS.refreshPr(), t.ctx);
    await t.settle();
    expect(t.asyncOps.run.mock.calls[0]?.[0]).toBe('refresh-pr');
    expect(t.sessions.refreshPr).toHaveBeenCalledOnce();
  });
});

describe('sidebar handler — sync-origin', () => {
  it('triggers a sync under the sync operation', async () => {
    const t = makeCtx();
    press(KEYS.syncOrigin(), t.ctx);
    await t.settle();
    expect(t.asyncOps.run.mock.calls[0]?.[0]).toBe('sync');
    expect(t.sessions.triggerSync).toHaveBeenCalledOnce();
  });
});

// ── checkout-branch ──────────────────────────────────────────────

describe('sidebar handler — checkout-branch', () => {
  it('loads branches and opens the picker in create mode', async () => {
    vi.mocked(listAllBranches).mockResolvedValue(['master', 'feat/x']);
    const t = makeCtx();

    press(KEYS.checkoutBranch(), t.ctx);
    await t.settle();

    expect(t.asyncOps.run.mock.calls[0]?.[0]).toBe('fetch-branches');
    expect(t.branchPicker.setBranches).toHaveBeenCalledExactlyOnceWith([
      'master',
      'feat/x',
    ]);
    expect(t.branchPicker.setCreating).toHaveBeenCalledExactlyOnceWith(true);
    expect(t.branchPicker.setBranchFilter).toHaveBeenCalledExactlyOnceWith('');
    expect(t.branchPicker.setBranchIndex).toHaveBeenCalledExactlyOnceWith(0);
  });
});

// ── focus-terminal ───────────────────────────────────────────────

describe('sidebar handler — focus-terminal', () => {
  it('focuses a live terminal for the selected session', () => {
    liveSessions.add(worktreeSessionKey('/wt/alpha'));
    const t = makeCtx({
      selectedItem: sessionItem('/wt/alpha'),
      sessionNameForTerminal: worktreeSessionKey('/wt/alpha'),
    });

    press(KEYS.focusTerminal(), t.ctx);

    expect(t.pane.setPaneMode).toHaveBeenCalledExactlyOnceWith('terminal');
    expect(t.pane.setReconnectKey).toHaveBeenCalledOnce();
    expect(t.nav.setFocus).toHaveBeenCalledExactlyOnceWith('terminal');
    expect(t.pane.setSessionMenu).not.toHaveBeenCalled();
  });

  it('opens the session menu for a session row with no live PTY', () => {
    const t = makeCtx({
      selectedItem: sessionItem('/wt/alpha'),
      sessionNameForTerminal: worktreeSessionKey('/wt/alpha'),
    });

    press(KEYS.focusTerminal(), t.ctx);

    expect(t.pane.setPaneMode).toHaveBeenCalledExactlyOnceWith('confirm');
    expect(t.pane.setSessionMenu).toHaveBeenCalledExactlyOnceWith({
      pr: null,
      selectedOption: 0,
      agentIndex: 0,
    });
    expect(t.nav.setFocus).not.toHaveBeenCalled();
    expect(t.asyncOps.run).not.toHaveBeenCalled();
  });

  it('opens the session menu for a session whose agent exited', () => {
    // The exited entry keeps its final frame in the registry, but there
    // is nothing to focus into — offer to start it again.
    exitedSessions.add(worktreeSessionKey('/wt/alpha'));
    const t = makeCtx({
      selectedItem: sessionItem('/wt/alpha'),
      sessionNameForTerminal: worktreeSessionKey('/wt/alpha'),
    });

    press(KEYS.focusTerminal(), t.ctx);

    expect(t.pane.setPaneMode).toHaveBeenCalledExactlyOnceWith('confirm');
    expect(t.pane.setSessionMenu).toHaveBeenCalledOnce();
    expect(t.nav.setFocus).not.toHaveBeenCalled();
  });

  it('opens the session menu with the PR for a PR row with no live PTY', () => {
    const pr = makePr();
    const t = makeCtx({
      selectedItem: reviewPrItem(pr, true),
      sessionNameForTerminal: PR_SESSION,
    });

    press(KEYS.focusTerminal(), t.ctx);

    expect(t.pane.setPaneMode).toHaveBeenCalledExactlyOnceWith('confirm');
    expect(t.pane.setSessionMenu).toHaveBeenCalledExactlyOnceWith({
      pr,
      selectedOption: 0,
      agentIndex: 0,
    });
    expect(t.nav.setFocus).not.toHaveBeenCalled();
  });

  it('refuses to open the menu while a start is already in flight', () => {
    const t = makeCtx({
      selectedItem: sessionItem('/wt/alpha'),
      sessionNameForTerminal: worktreeSessionKey('/wt/alpha'),
    });
    t.asyncOps.isRunning.mockReturnValue(true);

    press(KEYS.focusTerminal(), t.ctx);

    expect(t.pane.setSessionMenu).not.toHaveBeenCalled();
    expect(t.pane.setPaneMode).not.toHaveBeenCalled();
    expect(t.sessions.flashStatus).toHaveBeenCalledExactlyOnceWith(
      'A session is already starting…'
    );
  });

  it('does nothing when there is no selected item', () => {
    const t = makeCtx({
      sessionNameForTerminal: worktreeSessionKey('/wt/alpha'),
    });

    press(KEYS.focusTerminal(), t.ctx);

    expect(t.pane.setPaneMode).not.toHaveBeenCalled();
    expect(t.pane.setSessionMenu).not.toHaveBeenCalled();
  });

  it('does not open the menu when no terminal session is bound', () => {
    const t = makeCtx({
      selectedItem: sessionItem('/wt/alpha'),
      sessionNameForTerminal: null,
    });

    press(KEYS.focusTerminal(), t.ctx);

    expect(t.pane.setSessionMenu).not.toHaveBeenCalled();
    expect(t.nav.setFocus).not.toHaveBeenCalled();
  });

  it('returns focus to the sidebar when the terminal is focused', () => {
    const t = makeCtx({
      focus: 'terminal',
      selectedItem: sessionItem('/wt/alpha'),
      sessionNameForTerminal: worktreeSessionKey('/wt/alpha'),
    });

    press(KEYS.focusTerminal(), t.ctx);

    expect(t.nav.setFocus).toHaveBeenCalledExactlyOnceWith('sidebar');
    expect(t.pane.setSessionMenu).not.toHaveBeenCalled();
  });
});

// ── delete-branch ────────────────────────────────────────────────

describe('sidebar handler — delete-branch', () => {
  it('deletes a clean branch whose agent has already exited', async () => {
    const t = makeCtx({ selectedItem: sessionItem('/wt/alpha') });
    vi.mocked(listWorktrees).mockResolvedValue([
      worktree('/wt/alpha', 'alpha'),
    ]);

    press(KEYS.deleteBranch(), t.ctx);
    await t.settle();

    expect(t.asyncOps.run.mock.calls[0]?.[0]).toBe('check-delete');
    expect(t.sessions.performDelete).toHaveBeenCalledExactlyOnceWith(
      worktreeSessionKey('/wt/alpha'),
      'alpha'
    );
    expect(t.deleteConfirm.setConfirmDelete).not.toHaveBeenCalled();
  });

  it('asks yes/no before killing a still-running agent', async () => {
    liveSessions.add(worktreeSessionKey('/wt/alpha'));
    const t = makeCtx({ selectedItem: sessionItem('/wt/alpha') });
    vi.mocked(listWorktrees).mockResolvedValue([
      worktree('/wt/alpha', 'alpha'),
    ]);

    press(KEYS.deleteBranch(), t.ctx);
    await t.settle();

    expect(t.deleteConfirm.setConfirmDelete).toHaveBeenCalledExactlyOnceWith({
      branch: 'alpha',
      sessionName: worktreeSessionKey('/wt/alpha'),
      reason: 'session is active — agent process will be killed',
      mode: 'yes-no',
    });
    expect(t.deleteConfirm.setConfirmInput).toHaveBeenCalledExactlyOnceWith('');
    expect(t.sessions.performDelete).not.toHaveBeenCalled();
  });

  it.each(['uncommitted changes', 'not pushed to upstream'])(
    'requires typing the branch name when unsafe: %s',
    async (reason) => {
      const t = makeCtx({ selectedItem: sessionItem('/wt/alpha') });
      vi.mocked(listWorktrees).mockResolvedValue([
        worktree('/wt/alpha', 'alpha'),
      ]);
      vi.mocked(canRemoveBranch).mockResolvedValue({ safe: false, reason });

      press(KEYS.deleteBranch(), t.ctx);
      await t.settle();

      expect(t.deleteConfirm.setConfirmDelete).toHaveBeenCalledExactlyOnceWith({
        branch: 'alpha',
        sessionName: worktreeSessionKey('/wt/alpha'),
        reason,
        mode: 'type-branch',
      });
      expect(t.deleteConfirm.setConfirmInput).toHaveBeenCalledExactlyOnceWith(
        ''
      );
      expect(t.sessions.performDelete).not.toHaveBeenCalled();
      expect(t.sessions.flashStatus).not.toHaveBeenCalled();
    }
  );

  it('flashes and stops for a non-overridable unsafe reason', async () => {
    const t = makeCtx({ selectedItem: sessionItem('/wt/alpha') });
    vi.mocked(listWorktrees).mockResolvedValue([
      worktree('/wt/alpha', 'alpha'),
    ]);
    vi.mocked(canRemoveBranch).mockResolvedValue({
      safe: false,
      reason: 'protected branch',
    });

    press(KEYS.deleteBranch(), t.ctx);
    await t.settle();

    expect(t.sessions.flashStatus).toHaveBeenCalledExactlyOnceWith(
      'Cannot delete: protected branch'
    );
    expect(t.deleteConfirm.setConfirmDelete).not.toHaveBeenCalled();
    expect(t.sessions.performDelete).not.toHaveBeenCalled();
  });

  it('kills the orphaned PTY when the row has no worktree left', async () => {
    const t = makeCtx({ selectedItem: sessionItem('/wt/alpha') });
    vi.mocked(listWorktrees).mockResolvedValue([]);

    press(KEYS.deleteBranch(), t.ctx);
    await t.settle();

    expect(killSessionMock).toHaveBeenCalledExactlyOnceWith(
      worktreeSessionKey('/wt/alpha')
    );
    expect(t.pane.setReconnectKey).toHaveBeenCalledOnce();
    expect(t.sessions.refreshSessions).toHaveBeenCalledOnce();
    expect(canRemoveBranch).not.toHaveBeenCalled();
  });

  it("uses the checkout's session for a running review PR", async () => {
    const t = makeCtx({
      selectedItem: reviewPrItem(makePr({ sourceBranch: 'feat/thing' }), true),
    });
    vi.mocked(listWorktrees).mockResolvedValue([
      worktree('/wt/feat-thing', 'feat/thing'),
    ]);

    press(KEYS.deleteBranch(), t.ctx);
    await t.settle();

    expect(t.sessions.performDelete).toHaveBeenCalledExactlyOnceWith(
      PR_SESSION,
      'feat/thing'
    );
  });

  it('ignores a review PR that has never had a session', () => {
    const t = makeCtx({ selectedItem: reviewPrItem(makePr()) });

    press(KEYS.deleteBranch(), t.ctx);

    expect(t.asyncOps.run).not.toHaveBeenCalled();
  });

  it('ignores an orphan PR row', () => {
    const t = makeCtx({ selectedItem: orphanPrItem(makePr(), true) });

    press(KEYS.deleteBranch(), t.ctx);

    expect(t.asyncOps.run).not.toHaveBeenCalled();
  });

  it('ignores an empty selection', () => {
    const t = makeCtx();

    press(KEYS.deleteBranch(), t.ctx);

    expect(t.asyncOps.run).not.toHaveBeenCalled();
  });
});

// ── kill-agent ───────────────────────────────────────────────────

describe('sidebar handler — kill-agent', () => {
  it('kills the session and reconnects the pane', async () => {
    const t = makeCtx({ selectedItem: sessionItem('/wt/alpha') });

    press(KEYS.killAgent(), t.ctx);
    await t.settle();

    expect(t.asyncOps.run.mock.calls[0]?.[0]).toBe('delete');
    expect(killSessionMock).toHaveBeenCalledExactlyOnceWith(
      worktreeSessionKey('/wt/alpha')
    );
    expect(t.sessions.refreshSessions).toHaveBeenCalledOnce();
    expect(t.pane.setReconnectKey).toHaveBeenCalledOnce();
  });

  it("uses the checkout's session for a running review PR", async () => {
    const t = makeCtx({
      selectedItem: reviewPrItem(makePr({ sourceBranch: 'feat/thing' }), false),
    });

    press(KEYS.killAgent(), t.ctx);
    await t.settle();

    expect(killSessionMock).toHaveBeenCalledExactlyOnceWith(PR_SESSION);
  });

  it('ignores a review PR that has never had a session', () => {
    const t = makeCtx({ selectedItem: reviewPrItem(makePr()) });

    press(KEYS.killAgent(), t.ctx);

    expect(t.asyncOps.run).not.toHaveBeenCalled();
    expect(t.pane.setReconnectKey).not.toHaveBeenCalled();
  });
});

// ── rebase ───────────────────────────────────────────────────────

describe('sidebar handler — rebase', () => {
  it.each([
    ['success', 'Rebased onto origin successfully'],
    ['conflict', 'Conflicts detected — rebase aborted'],
    ['error', 'Failed to fetch from origin'],
  ] as const)('reports %s', async (outcome, message) => {
    const t = makeCtx({ selectedItem: sessionItem('/wt/alpha') });
    vi.mocked(listWorktrees).mockResolvedValue([
      worktree('/wt/alpha', 'alpha'),
    ]);
    vi.mocked(rebaseOntoMaster).mockResolvedValue(outcome);

    press(KEYS.rebase(), t.ctx);
    await t.settle();

    expect(t.asyncOps.run.mock.calls[0]?.[0]).toBe('rebase');
    expect(rebaseOntoMaster).toHaveBeenCalledExactlyOnceWith('/wt/alpha');
    expect(t.sessions.flashStatus).toHaveBeenCalledExactlyOnceWith(message);
  });

  it('flashes when the session has no worktree', async () => {
    const t = makeCtx({ selectedItem: sessionItem('/wt/alpha') });
    vi.mocked(listWorktrees).mockResolvedValue([]);

    press(KEYS.rebase(), t.ctx);
    await t.settle();

    expect(t.sessions.flashStatus).toHaveBeenCalledExactlyOnceWith(
      'No worktree found for selected session'
    );
    expect(rebaseOntoMaster).not.toHaveBeenCalled();
  });

  it('ignores PR rows', () => {
    const t = makeCtx({ selectedItem: reviewPrItem(makePr(), true) });

    press(KEYS.rebase(), t.ctx);

    expect(t.asyncOps.run).not.toHaveBeenCalled();
  });
});

// ── open-editor ──────────────────────────────────────────────────

describe('sidebar handler — open-editor', () => {
  const savedVisual = process.env.VISUAL;
  const savedEditor = process.env.EDITOR;

  beforeEach(() => {
    delete process.env.VISUAL;
    delete process.env.EDITOR;
  });

  afterEach(() => {
    if (savedVisual === undefined) delete process.env.VISUAL;
    else process.env.VISUAL = savedVisual;
    if (savedEditor === undefined) delete process.env.EDITOR;
    else process.env.EDITOR = savedEditor;
  });

  it('spawns the configured editor detached on the session worktree', async () => {
    const t = makeCtx({
      selectedItem: sessionItem('/wt/alpha'),
      editor: 'code',
    });
    vi.mocked(listWorktrees).mockResolvedValue([
      worktree('/wt/alpha', 'alpha'),
    ]);

    press(KEYS.openEditor(), t.ctx);
    await t.settle();

    expect(t.asyncOps.run.mock.calls[0]?.[0]).toBe('open-editor');
    expect(spawn).toHaveBeenCalledExactlyOnceWith('code', ['/wt/alpha'], {
      detached: true,
      stdio: 'ignore',
    });
    expect(t.sessions.flashStatus).toHaveBeenCalledExactlyOnceWith(
      'Opened in code'
    );
    expect(t.sessions.refreshSessions).not.toHaveBeenCalled();
  });

  it('checks out a PR row on demand and refreshes sessions', async () => {
    const t = makeCtx({
      selectedItem: orphanPrItem(makePr({ sourceBranch: 'feat/thing' })),
      editor: 'code',
    });
    vi.mocked(listWorktrees).mockResolvedValue([]);
    vi.mocked(createWorktree).mockResolvedValue('/wt/feat-thing');

    press(KEYS.openEditor(), t.ctx);
    await t.settle();

    expect(createWorktree).toHaveBeenCalledExactlyOnceWith('feat/thing');
    expect(t.sessions.refreshSessions).toHaveBeenCalledOnce();
    expect(spawn).toHaveBeenCalledExactlyOnceWith(
      'code',
      ['/wt/feat-thing'],
      expect.anything()
    );
  });

  it('falls back to $VISUAL then $EDITOR', async () => {
    process.env.VISUAL = 'vis';
    const t = makeCtx({ selectedItem: sessionItem('/wt/alpha') });
    vi.mocked(listWorktrees).mockResolvedValue([
      worktree('/wt/alpha', 'alpha'),
    ]);

    press(KEYS.openEditor(), t.ctx);
    await t.settle();

    expect(spawn).toHaveBeenCalledExactlyOnceWith(
      'vis',
      ['/wt/alpha'],
      expect.anything()
    );

    delete process.env.VISUAL;
    process.env.EDITOR = 'ed';
    const t2 = makeCtx({ selectedItem: sessionItem('/wt/alpha') });

    press(KEYS.openEditor(), t2.ctx);
    await t2.settle();

    expect(spawn).toHaveBeenLastCalledWith(
      'ed',
      ['/wt/alpha'],
      expect.anything()
    );
  });

  it('flashes when no editor is configured anywhere', async () => {
    const t = makeCtx({ selectedItem: sessionItem('/wt/alpha') });
    vi.mocked(listWorktrees).mockResolvedValue([
      worktree('/wt/alpha', 'alpha'),
    ]);

    press(KEYS.openEditor(), t.ctx);
    await t.settle();

    expect(spawn).not.toHaveBeenCalled();
    expect(t.sessions.flashStatus).toHaveBeenCalledExactlyOnceWith(
      'No editor configured — set one in settings'
    );
  });

  it('flashes when no path can be resolved', async () => {
    const t = makeCtx({
      selectedItem: sessionItem('/wt/alpha'),
      editor: 'code',
    });
    vi.mocked(listWorktrees).mockResolvedValue([]);

    press(KEYS.openEditor(), t.ctx);
    await t.settle();

    expect(t.sessions.flashStatus).toHaveBeenCalledExactlyOnceWith(
      'No worktree found for selected session'
    );
    expect(spawn).not.toHaveBeenCalled();
  });

  it('ignores an empty selection', () => {
    const t = makeCtx({ editor: 'code' });

    press(KEYS.openEditor(), t.ctx);

    expect(t.asyncOps.run).not.toHaveBeenCalled();
  });
});

// ── view-diff / view-comments ────────────────────────────────────

describe('sidebar handler — view-diff', () => {
  it('opens the diff pane at the first file for a PR row', () => {
    const t = makeCtx({ selectedItem: orphanPrItem(makePr()) });

    press(KEYS.viewDiff(), t.ctx);

    expect(t.pane.setPaneMode).toHaveBeenCalledExactlyOnceWith('diff');
    expect(t.pane.setDiffFileIndex).toHaveBeenCalledExactlyOnceWith(0);
  });

  it('does nothing for a session row with no PR', () => {
    const t = makeCtx({ selectedItem: sessionItem('/wt/alpha') });

    press(KEYS.viewDiff(), t.ctx);

    expect(t.pane.setPaneMode).not.toHaveBeenCalled();
    expect(t.pane.setDiffFileIndex).not.toHaveBeenCalled();
  });
});

describe('sidebar handler — view-comments', () => {
  it('opens the comments pane reset to the top for a PR row', () => {
    const t = makeCtx({ selectedItem: reviewPrItem(makePr(), true) });

    press(KEYS.viewComments(), t.ctx);

    expect(t.pane.setPaneMode).toHaveBeenCalledExactlyOnceWith('comments');
    expect(t.pane.setGeneralCommentsIndex).toHaveBeenCalledExactlyOnceWith(0);
    expect(
      t.pane.setGeneralCommentsScrollOffset
    ).toHaveBeenCalledExactlyOnceWith(0);
  });

  it('does nothing for a session row with no PR', () => {
    const t = makeCtx({ selectedItem: sessionItem('/wt/alpha') });

    press(KEYS.viewComments(), t.ctx);

    expect(t.pane.setPaneMode).not.toHaveBeenCalled();
  });
});

// ── start-session ────────────────────────────────────────────────

describe('sidebar handler — start-session', () => {
  it('focuses the terminal when the selected session is live', () => {
    liveSessions.add(worktreeSessionKey('/wt/alpha'));
    const t = makeCtx({
      selectedItem: sessionItem('/wt/alpha'),
      sessionNameForTerminal: worktreeSessionKey('/wt/alpha'),
    });

    press(KEYS.startSession(), t.ctx);

    expect(t.pane.setPaneMode).toHaveBeenCalledExactlyOnceWith('terminal');
    expect(t.pane.setReconnectKey).toHaveBeenCalledOnce();
    expect(t.nav.setFocus).toHaveBeenCalledExactlyOnceWith('terminal');
    expect(t.pane.setSessionMenu).not.toHaveBeenCalled();
  });

  it('opens the session menu for a PR-less session row', () => {
    const t = makeCtx({ selectedItem: sessionItem('/wt/alpha') });

    press(KEYS.startSession(), t.ctx);

    expect(t.asyncOps.run).not.toHaveBeenCalled();
    expect(t.pane.setPaneMode).toHaveBeenCalledExactlyOnceWith('confirm');
    expect(t.pane.setSessionMenu).toHaveBeenCalledExactlyOnceWith({
      pr: null,
      selectedOption: 0,
      agentIndex: 0,
    });
    expect(t.nav.setFocus).not.toHaveBeenCalled();
  });

  it('opens the session menu when the bound session name is stale', () => {
    // `sessionNameForTerminal` still names this row's session but the
    // PTY exited, so Enter offers a relaunch instead of focusing an
    // empty pane — the same staleness the switch-tab digits guard
    // against.
    const t = makeCtx({
      selectedItem: sessionItem('/wt/alpha'),
      sessionNameForTerminal: worktreeSessionKey('/wt/alpha'),
    });

    press(KEYS.startSession(), t.ctx);

    expect(t.pane.setPaneMode).toHaveBeenCalledExactlyOnceWith('confirm');
    expect(t.pane.setSessionMenu).toHaveBeenCalledOnce();
  });

  it('opens the session menu with the PR for a session row that has a PR', () => {
    const pr = makePr();
    const t = makeCtx({ selectedItem: sessionItem('/wt/alpha', { pr }) });

    press(KEYS.startSession(), t.ctx);

    expect(t.pane.setPaneMode).toHaveBeenCalledExactlyOnceWith('confirm');
    expect(t.pane.setSessionMenu).toHaveBeenCalledExactlyOnceWith({
      pr,
      selectedOption: 0,
      agentIndex: 0,
    });
  });

  it('opens the session menu with the PR for a PR row', () => {
    const pr = makePr();
    const t = makeCtx({ selectedItem: orphanPrItem(pr) });

    press(KEYS.startSession(), t.ctx);

    expect(t.pane.setPaneMode).toHaveBeenCalledExactlyOnceWith('confirm');
    expect(t.pane.setSessionMenu).toHaveBeenCalledExactlyOnceWith({
      pr,
      selectedOption: 0,
      agentIndex: 0,
    });
  });

  it('focuses the live terminal instead of the menu for a PR row with a session', () => {
    liveSessions.add(PR_SESSION);
    const t = makeCtx({
      selectedItem: orphanPrItem(makePr({ sourceBranch: 'feat/thing' })),
      sessionNameForTerminal: PR_SESSION,
    });

    press(KEYS.startSession(), t.ctx);

    expect(t.pane.setPaneMode).toHaveBeenCalledExactlyOnceWith('terminal');
    expect(t.nav.setFocus).toHaveBeenCalledExactlyOnceWith('terminal');
    expect(t.pane.setSessionMenu).not.toHaveBeenCalled();
  });

  it('ignores an empty selection', () => {
    const t = makeCtx();

    press(KEYS.startSession(), t.ctx);

    expect(t.pane.setPaneMode).not.toHaveBeenCalled();
    expect(t.pane.setSessionMenu).not.toHaveBeenCalled();
  });
});
