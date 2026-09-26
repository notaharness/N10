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

  it('leaves the pull request row it left behind free to open in a tab of its own', () => {
    let s = open(EMPTY_TABS, 'pr:12');
    s = sync(s, [worktree('feature', { itemKey: 'pr:12' })]);
    s = sync(s, [
      { itemKey: 'pr:12', branch: 'feature', title: 'Add undo' },
      worktree('other'),
    ]);
    s = open(s, 'pr:12');
    expect(s.tabs.map((t) => t.kind === 'item' && t.itemKey)).toEqual([
      'branch:other',
      'pr:12',
    ]);
    expect(new Set(s.tabs.map((t) => t.id)).size).toBe(2);
    const opened = s.tabs[1];
    expect(s.activeId).toBe(opened.id);
    // Opening it again finds that tab, not the worktree's.
    s = open(s, 'branch:other');
    s = open(s, 'pr:12');
    expect(s.tabs).toHaveLength(2);
    expect(s.activeId).toBe(opened.id);
  });

  it('opens its old branch in a new tab rather than the switched one', () => {
    let s = open(EMPTY_TABS, 'branch:feature');
    s = sync(s, [worktree('feature')]);
    s = sync(s, [worktree('other')]);
    s = open(s, 'branch:feature');
    expect(s.tabs.map((t) => t.kind === 'item' && t.itemKey)).toEqual([
      'branch:other',
      'branch:feature',
    ]);
    expect(s.tabs[1].id).toBe(`${itemTabId(REPO, 'branch:feature')}~2`);
  });

  it('is found by the id it was opened with again once back on its branch', () => {
    let s = open(EMPTY_TABS, 'branch:feature');
    s = sync(s, [worktree('feature')]);
    s = sync(s, [worktree('feature', { itemKey: 'pr:12' })]);
    s = open(s, 'branch:feature');
    expect(s.tabs).toHaveLength(1);
  });
});
