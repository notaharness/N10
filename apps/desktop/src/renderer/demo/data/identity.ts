import type { PullRequestInfo } from '@n10/vcs-core';
import type {
  BabysitStatus,
  PullRequestComments,
  SidebarItem,
} from '../../../host/contract.js';

/**
 * Who is at the keyboard, how the demo's repositories are described,
 * and the keys core would give their sessions.
 */
export const VIEWER = 'HermannBjorgvin';
export const TEAMMATE = 'sofia-codes';
export const HOME = '/home/you';

type Loader = () => Promise<{ default: string }>;

/** One repository the demo knows, as its host would read it off disk
 *  and the provider. */
export interface RepoData {
  cwd: string;
  /** The repository's `owner/name` on GitHub. */
  slug: string;
  sidebar: () => SidebarItem[];
  threads?: () => Record<number, PullRequestComments>;
  /** Whole-file patches by source branch, loaded on demand. */
  diffs: Record<string, Loader>;
  descriptions: Record<number, Loader>;
  branches: readonly string[];
  /** Branches with a worktree, besides the main checkout's. */
  worktrees: readonly string[];
  defaultBranch: string;
}

/** A worktree session's key, as core builds it (`worktreeSessionKey`):
 *  the machine is appended only when it is not this one. */
export function sessionKey(repo: string, branch: string, machine = 'local') {
  return JSON.stringify(
    machine === 'local'
      ? ['worktree', repo, branch]
      : ['worktree', repo, branch, machine]
  );
}

/** Where n10's default Worktree Path puts a branch's checkout. */
export function worktreeDir(repo: string, branch: string): string {
  return `${repo}/.claude/worktrees/${branch.replace(/[^\w.-]/g, '-')}`;
}

/** `worktreeDir` as a shell prompt or banner would print it. */
export function displayDir(repo: string, branch: string): string {
  return worktreeDir(repo, branch).replace(HOME, '~');
}

export function prUrl(slug: string, id: number): string {
  return `https://github.com/${slug}/pull/${id}`;
}

export const babysitting = (pr: PullRequestInfo): BabysitStatus => ({
  prId: pr.id,
  sourceBranch: pr.sourceBranch,
  phase: 'watching',
  held: null,
  lastPolledAt: Date.now(),
  pendingSince: null,
  lastDeliveredAt: Date.now(),
  deliveries: 1,
  lastError: null,
});
