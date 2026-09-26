import { describe, expect, it } from 'vitest';
import { itemTabId } from './tab-identity.js';
import {
  EMPTY_TABS,
  reduce,
  type ItemEntry,
  type TabsState,
} from './tabs-model.js';

/**
 * A worktree tab is its checkout, not its branch: `git switch` inside
 * the worktree moves the tab with it, and the tab remembers the branch
 * it was opened for.
 */

const REPO = '/repos/alpha';
const WT = '/repos/alpha/.claude/worktrees/feature';

const open = (state: TabsState, itemKey: string) =>
  reduce(state, { type: 'open-item', repo: REPO, itemKey, preview: false });

const sync = (state: TabsState, entries: ItemEntry[]) =>
  reduce(state, { type: 'sync-items', repo: REPO, entries });

const worktree = (branch: string, extra: Partial<ItemEntry> = {}) => ({
  itemKey: `branch:${branch}`,
  branch,
  title: branch,
  worktree: WT,
  ...extra,
});

describe('a worktree that switches branch', () => {
  it('keeps its tab, which follows the checkout onto the new branch', () => {
    let s = open(EMPTY_TABS, 'branch:feature');
    s = sync(s, [worktree('feature')]);
    s = sync(s, [worktree('other')]);
    expect(s.tabs).toEqual([
      expect.objectContaining({
        id: itemTabId(REPO, 'branch:feature'),
        itemKey: 'branch:other',
        branch: 'other',
        title: 'other',
        worktree: WT,
        originBranch: 'feature',
      }),
    ]);
    expect(s.activeId).toBe(itemTabId(REPO, 'branch:feature'));
  });

  it('follows the checkout even when its pull request row stays behind', () => {
    let s = open(EMPTY_TABS, 'pr:12');
    s = sync(s, [worktree('feature', { itemKey: 'pr:12' })]);
    s = sync(s, [
      { itemKey: 'pr:12', branch: 'feature', title: 'Add undo' },
      worktree('other'),
    ]);
    expect(s.tabs).toEqual([
      expect.objectContaining({ itemKey: 'branch:other', originBranch: 'feature' }),
    ]);
  });

  it('keeps the branch it was opened for through a switch back', () => {
    let s = open(EMPTY_TABS, 'branch:feature');
    s = sync(s, [worktree('feature')]);
    s = sync(s, [worktree('other')]);
    s = sync(s, [worktree('feature')]);
    expect(s.tabs).toEqual([
      expect.objectContaining({
        itemKey: 'branch:feature',
        branch: 'feature',
        originBranch: 'feature',
      }),
    ]);
  });

  it('takes its original branch from the agent session when reopened for one', () => {
    const entry = worktree('other', {
      running: true,
      sessionName: 'feature-session',
      sessionBranch: 'feature',
    });
    let s = sync(EMPTY_TABS, [entry]);
    s = sync(s, [entry]);
    expect(s.tabs).toEqual([
      expect.objectContaining({ itemKey: 'branch:other', originBranch: 'feature' }),
    ]);
  });
});
