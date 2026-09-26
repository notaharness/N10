import { worktreeSessionKey } from '@n10/core';
import { describe, it, expect, vi } from 'vitest';
import type { PullRequestInfo } from '@n10/vcs-core';
import type { WorktreeInfo } from '@n10/worktree-manager';
import type { SidebarItem } from '@n10/core';
import { resolveEditorTarget } from './editor-target.js';

function makePr(overrides: Partial<PullRequestInfo> = {}): PullRequestInfo {
  return {
    id: 1,
    title: 'PR #1',
    sourceBranch: 'feature/foo',
    targetBranch: 'main',
    url: '',
    createdByIdentifier: 'me@test.com',
    createdByDisplayName: 'Me',
    ...overrides,
  };
}

const wt = (path: string, branch: string): WorktreeInfo => ({
  path,
  branch,
  bare: false,
});

describe('resolveEditorTarget', () => {
  it('returns the existing worktree path for a session row', async () => {
    const item: SidebarItem = {
      kind: 'session',
      session: { name: worktreeSessionKey('/wt/feature-foo'), running: false },
      isMerged: false,
    };
    const path = await resolveEditorTarget(item, {
      listWorktrees: async () => [wt('/wt/feature-foo', 'feature/foo')],
      createWorktree: vi.fn(),
    });
    expect(path).toBe('/wt/feature-foo');
  });

  it('does NOT auto-create for a session row when no worktree is found', async () => {
    // Sessions are derived from worktrees, so this is a stale-state
    // case — we surface null rather than silently materializing a new
    // worktree under the user.
    const item: SidebarItem = {
      kind: 'session',
      session: { name: worktreeSessionKey('/wt/feature-foo'), running: false },
      isMerged: false,
    };
    const createWorktree = vi.fn();
    const path = await resolveEditorTarget(item, {
      listWorktrees: async () => [],
      createWorktree,
    });
    expect(path).toBeNull();
    expect(createWorktree).not.toHaveBeenCalled();
  });

  it('creates a worktree on the fly for an orphan-pr row', async () => {
    const item: SidebarItem = {
      kind: 'orphan-pr',
      pr: makePr({ sourceBranch: 'feature/foo' }),
    };
    const createWorktree = vi.fn().mockResolvedValue('/wt/feature-foo');
    const path = await resolveEditorTarget(item, {
      listWorktrees: async () => [],
      createWorktree,
    });
    expect(path).toBe('/wt/feature-foo');
    expect(createWorktree).toHaveBeenCalledWith('feature/foo');
  });

  it('creates a worktree on the fly for a review-pr row', async () => {
    const item: SidebarItem = {
      kind: 'review-pr',
      pr: makePr({ sourceBranch: 'feature/bar' }),
      category: 'needs-review',
    };
    const createWorktree = vi.fn().mockResolvedValue('/wt/feature-bar');
    const path = await resolveEditorTarget(item, {
      listWorktrees: async () => [],
      createWorktree,
    });
    expect(path).toBe('/wt/feature-bar');
    expect(createWorktree).toHaveBeenCalledWith('feature/bar');
  });

  it('reuses an existing worktree for a PR row instead of recreating', async () => {
    const item: SidebarItem = {
      kind: 'review-pr',
      pr: makePr({ sourceBranch: 'feature/bar' }),
      category: 'approved',
    };
    const createWorktree = vi.fn();
    const path = await resolveEditorTarget(item, {
      listWorktrees: async () => [wt('/wt/feature-bar', 'feature/bar')],
      createWorktree,
    });
    expect(path).toBe('/wt/feature-bar');
    expect(createWorktree).not.toHaveBeenCalled();
  });

  it('returns null when createWorktree fails for a PR row', async () => {
    const item: SidebarItem = {
      kind: 'orphan-pr',
      pr: makePr({ sourceBranch: 'feature/foo' }),
    };
    const path = await resolveEditorTarget(item, {
      listWorktrees: async () => [],
      createWorktree: async () => null,
    });
    expect(path).toBeNull();
  });
});
