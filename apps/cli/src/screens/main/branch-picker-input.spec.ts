import { worktreeSessionKey } from '@n10/core';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type * as CoreModule from '@n10/core';
import type * as WorktreeManagerModule from '@n10/worktree-manager';
import {
  ACTIONS,
  NORMIE_PRESET,
  __resetSessionMenuRequestForTests,
  peekSessionMenuRequest,
  resolveAction,
  type KeyPress,
} from '@n10/core';
import type { BranchPickerHandlerCtx } from './input-types.js';

// Where the branch picker lands once a worktree exists: a running
// session opens straight into its terminal; anything else asks the
// pane reducer for the session menu. The registry is mocked so nothing
// spawns; the request mailbox is the real one.

let liveSessions = new Set<string>();

vi.mock('@n10/core', async (importOriginal) => ({
  ...(await importOriginal<typeof CoreModule>()),
  isSessionAlive: (name: string) => liveSessions.has(name),
  fetchRefs: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('@n10/worktree-manager', async (importOriginal) => ({
  ...(await importOriginal<typeof WorktreeManagerModule>()),
  createWorktree: vi.fn(),
  listAllBranches: vi.fn(),
}));

import { createWorktree } from '@n10/worktree-manager';
import { handleBranchPickerInput } from './branch-picker-input.js';

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
    ...overrides,
  } as KeyPress;
}

function makeCtx(opts: { sessionNameForTerminal?: string | null } = {}) {
  const runCalls: Promise<void>[] = [];
  const asyncOps = {
    run: vi.fn((_name: string, fn: () => Promise<void>) => {
      const done = fn();
      runCalls.push(done);
      return done;
    }),
    isRunning: vi.fn(() => false),
    inFlight: new Set<string>(),
  };
  const branchPicker = {
    creating: true,
    branches: ['feat/x'],
    branchFilter: '',
    branchIndex: 0,
    setCreating: vi.fn(),
    setBranchFilter: vi.fn(),
    setBranchIndex: vi.fn(),
    setBranches: vi.fn(),
  };
  const sessions = {
    flashStatus: vi.fn(),
    refreshSessions: vi.fn().mockResolvedValue([]),
  };
  const sidebar = {
    selectByKey: vi.fn(),
    selectedItem: undefined,
    sessionNameForTerminal: opts.sessionNameForTerminal ?? null,
  };
  const pane = {
    setPaneMode: vi.fn(),
    setReconnectKey: vi.fn(),
    setSessionMenu: vi.fn(),
  };
  const nav = { focus: 'sidebar', setFocus: vi.fn() };
  const ctx = {
    branchPicker,
    sessions,
    sidebar,
    asyncOps,
    terminal: { paneCols: 80, paneRows: 24 },
    config: { config: { vendorAuth: {}, vendorProject: {} } },
    keybinds: {
      resolve: (input: string, key: KeyPress, context: 'branch-picker') =>
        resolveAction(input, key, context, NORMIE_PRESET.bindings, ACTIONS),
    },
    pane,
    nav,
  } as unknown as BranchPickerHandlerCtx;
  return {
    ctx,
    branchPicker,
    sessions,
    sidebar,
    pane,
    nav,
    settle: () => Promise.all(runCalls),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  liveSessions = new Set();
  __resetSessionMenuRequestForTests();
});

describe('branch picker — select', () => {
  it('creates the worktree, selects the session and asks for its menu', async () => {
    vi.mocked(createWorktree).mockResolvedValue('/wt/feat-x');
    const t = makeCtx();

    handleBranchPickerInput('', makeKey({ return: true }), t.ctx);
    await t.settle();

    expect(createWorktree).toHaveBeenCalledExactlyOnceWith('feat/x');
    expect(t.sessions.refreshSessions).toHaveBeenCalledOnce();
    expect(t.sidebar.selectByKey).toHaveBeenCalledExactlyOnceWith(
      `session:${worktreeSessionKey('/wt/feat-x')}`
    );
    // The menu is not set on this pane — the selection move (or the
    // refresh before it) can remount it; the request is what survives.
    expect(t.pane.setSessionMenu).not.toHaveBeenCalled();
    expect(t.pane.setPaneMode).not.toHaveBeenCalled();
    expect(peekSessionMenuRequest()).toBe(worktreeSessionKey('/wt/feat-x'));
    expect(t.branchPicker.setCreating).toHaveBeenCalledExactlyOnceWith(false);
  });

  it('opens straight into a session that is already running', async () => {
    vi.mocked(createWorktree).mockResolvedValue('/wt/feat-x');
    liveSessions.add(worktreeSessionKey('/wt/feat-x'));
    const t = makeCtx();

    handleBranchPickerInput('', makeKey({ return: true }), t.ctx);
    await t.settle();

    expect(t.sidebar.selectByKey).toHaveBeenCalledExactlyOnceWith(
      `session:${worktreeSessionKey('/wt/feat-x')}`
    );
    expect(t.pane.setPaneMode).toHaveBeenCalledExactlyOnceWith('terminal');
    expect(t.nav.setFocus).toHaveBeenCalledExactlyOnceWith('terminal');
    expect(peekSessionMenuRequest()).toBeNull();
  });

  it('leaves the selection alone when the worktree cannot be created', async () => {
    vi.mocked(createWorktree).mockResolvedValue(null as unknown as string);
    const t = makeCtx();

    handleBranchPickerInput('', makeKey({ return: true }), t.ctx);
    await t.settle();

    expect(t.sidebar.selectByKey).not.toHaveBeenCalled();
    expect(peekSessionMenuRequest()).toBeNull();
  });
});
