import { beforeEach, expect, it, vi } from 'vitest';
import { worktreeSessionKey } from '../session-key.js';
const state = vi.hoisted(() => ({ calls: [] as unknown[], removed: true }));
vi.mock('../pty-registry.js', () => ({
  hasSession: () => true,
  killSession: (key: string) => state.calls.push(['kill', key]),
}));
vi.mock('../session-backend.js', () => ({
  killPersistedTmuxSession: (key: string) =>
    state.calls.push(['persisted', key]),
}));
vi.mock('@n10/worktree-manager', () => ({
  listWorktrees: async () => [
    { branch: 'main', path: '/repo-a' },
    { branch: 'feature/login', path: '/repo-a/.worktrees/login' },
  ],
  removeWorktree: async (branch: string, opts: unknown) => {
    state.calls.push(['remove', branch, opts]);
    return state.removed;
  },
  deleteBranch: async (...args: unknown[]) => {
    state.calls.push(['delete', ...args]);
    return true;
  },
}));
import { removeWorktreeSession } from './remove-worktree.js';
beforeEach(() => {
  state.calls = [];
  state.removed = true;
});
it('stops only the qualified agent before removing its checkout and branch in the captured repo', async () => {
  await removeWorktreeSession('feature/login', true, '/repo-a');
  const key = worktreeSessionKey('/repo-a/.worktrees/login', '/repo-a');
  expect(state.calls).toEqual([
    ['kill', key],
    ['remove', 'feature/login', { force: true, cwd: '/repo-a' }],
    ['delete', 'feature/login', true, '/repo-a'],
  ]);
});
it('keeps the branch if checkout removal fails', async () => {
  state.removed = false;
  expect(await removeWorktreeSession('feature/login', false, '/repo-a')).toBe(
    false
  );
  expect(state.calls.some((c) => (c as string[])[0] === 'delete')).toBe(false);
});
