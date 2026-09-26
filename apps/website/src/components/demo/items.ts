import type { Beat } from '@/components/demo/model';
import { BABYSIT } from '@/components/demo/script-babysit';
import { DARK_MODE } from '@/components/demo/script-dark-mode';
import { COMMAND_PALETTE, REVIEW } from '@/components/demo/script-finished';

/**
 * The sidebar of the demo's `atlas` repository: the same worktrees and
 * pull requests as the product videos, each opening a tab with its own
 * scripted terminal.
 */
export type Section = 'worktrees' | 'pulls' | 'review';

export const SECTIONS: readonly { id: Section; title: string }[] = [
  { id: 'worktrees', title: 'Worktrees' },
  { id: 'pulls', title: 'Pull requests' },
  { id: 'review', title: 'Needs your review' },
];

export interface PullRequest {
  id: number;
  title: string;
  author: string;
  comments: number;
}

export interface DemoItem {
  id: string;
  section: Section;
  /** The row's first line, and the tab's label. */
  title: string;
  branch: string;
  pr?: PullRequest;
  /** A Claude Code script, or the worktree's zsh. */
  session: readonly Beat[] | 'zsh';
  babysitting?: boolean;
}

export const ITEMS: readonly DemoItem[] = [
  {
    id: 'dark-mode',
    section: 'worktrees',
    title: 'dark-mode',
    branch: 'dark-mode',
    session: DARK_MODE,
  },
  {
    id: 'perf-flamegraph',
    section: 'worktrees',
    title: 'perf-flamegraph',
    branch: 'perf-flamegraph',
    session: 'zsh',
  },
  {
    id: 'pr-128',
    section: 'pulls',
    title: 'Add a command palette',
    branch: 'command-palette',
    pr: {
      id: 128,
      title: 'Add a command palette',
      author: 'hermannb',
      comments: 2,
    },
    session: COMMAND_PALETTE,
  },
  {
    id: 'pr-124',
    section: 'pulls',
    title: 'Retry transient network failures',
    branch: 'retry-backoff',
    pr: {
      id: 124,
      title: 'Retry transient network failures',
      author: 'hermannb',
      comments: 1,
    },
    session: BABYSIT,
    babysitting: true,
  },
  {
    id: 'pr-131',
    section: 'review',
    title: 'Fix flaky session restore on resume',
    branch: 'fix-session-restore',
    pr: {
      id: 131,
      title: 'Fix flaky session restore on resume',
      author: 'sofia-codes',
      comments: 0,
    },
    session: REVIEW,
  },
];

export const FIRST_TABS: readonly string[] = [
  'pr-124',
  'dark-mode',
  'perf-flamegraph',
];

export function itemOf(id: string): DemoItem {
  return ITEMS.find((item) => item.id === id) as DemoItem;
}
