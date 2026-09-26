import { worktreeSessionKey } from '@n10/core';
import {
  fetchRefs,
  handleTextInput,
  type KeyPress,
  isSessionAlive,
  requestSessionMenu,
} from '@n10/core';
import { createWorktree, listAllBranches } from '@n10/worktree-manager';
import type { BranchPickerHandlerCtx } from './input-types.js';

/**
 * Where the user lands once the worktree exists. A session that is
 * already running has no agent left to choose, so it opens straight
 * into its terminal — same as Tab on its row. Otherwise the new
 * session's menu opens, through the request the pane reducer consumes:
 * the refresh above and the selection move here can each remount the
 * pane, so menu state set on this pane directly could land on one
 * that is already gone.
 */
function landInSession(ctx: BranchPickerHandlerCtx, sessionName: string): void {
  ctx.sidebar.selectByKey(`session:${sessionName}`);
  if (isSessionAlive(sessionName)) {
    ctx.pane.setPaneMode('terminal');
    ctx.pane.setReconnectKey((k) => k + 1);
    ctx.nav.setFocus('terminal');
    return;
  }
  requestSessionMenu(sessionName);
}

function resetPicker(ctx: BranchPickerHandlerCtx): void {
  ctx.branchPicker.setCreating(false);
  ctx.branchPicker.setBranchFilter('');
  ctx.branchPicker.setBranchIndex(0);
}

function fetchBranches(ctx: BranchPickerHandlerCtx): void {
  void ctx.asyncOps.run('fetch-branches', async () => {
    // No "Fetching remotes…" flash — the 'fetch-branches' spinner
    // (label: "Fetching branches") already shows we're working.
    await fetchRefs({ cwd: process.cwd(), refs: 'all' });
    const allBranches = await listAllBranches();
    ctx.branchPicker.setBranches(allBranches);
    ctx.branchPicker.setBranchIndex(0);
    ctx.sessions.flashStatus('Fetched remotes');
  });
}

function selectBranch(ctx: BranchPickerHandlerCtx, filtered: string[]): void {
  const branch =
    filtered.length > 0
      ? filtered[ctx.branchPicker.branchIndex]!
      : ctx.branchPicker.branchFilter.trim();
  if (branch) {
    void ctx.asyncOps.run('create-worktree', async () => {
      const worktreePath = await createWorktree(branch);
      if (!worktreePath) return;
      await ctx.sessions.refreshSessions();
      landInSession(ctx, worktreeSessionKey(worktreePath));
    });
  }
  resetPicker(ctx);
}

export function handleBranchPickerInput(
  input: string,
  key: KeyPress,
  ctx: BranchPickerHandlerCtx
): void {
  const action = ctx.keybinds.resolve(input, key, 'branch-picker');

  if (action === 'branch-picker.cancel') {
    resetPicker(ctx);
    return;
  }
  if (action === 'branch-picker.fetch') {
    fetchBranches(ctx);
    return;
  }

  const filtered = ctx.branchPicker.branches.filter((b) =>
    b.toLowerCase().includes(ctx.branchPicker.branchFilter.toLowerCase())
  );

  if (action === 'branch-picker.navigate-up') {
    ctx.branchPicker.setBranchIndex((i) => Math.max(i - 1, 0));
    return;
  }
  if (action === 'branch-picker.navigate-down') {
    ctx.branchPicker.setBranchIndex((i) =>
      Math.min(i + 1, filtered.length - 1)
    );
    return;
  }
  if (action === 'branch-picker.select') {
    selectBranch(ctx, filtered);
    return;
  }

  // Text input for branch filter (exempt from resolution)
  if (handleTextInput(input, key, ctx.branchPicker.setBranchFilter)) {
    ctx.branchPicker.setBranchIndex(0);
  }
}
