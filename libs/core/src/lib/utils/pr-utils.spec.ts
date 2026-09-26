import { worktreeSessionKey } from '../session-key.js';
import { describe, it, expect } from 'vitest';
import type {
  BranchPrMap,
  PullRequestInfo,
  AppConfig,
  VcsProvider,
} from '@n10/vcs-core';
import {
  findOrphanPrs,
  categorizeReviews,
  buildSessionPrMap,
} from './pr-utils.js';

// Minimal mock provider
const mockProvider: VcsProvider = {
  id: 'mock',
  displayName: 'Mock',
  authFields: [],
  projectFields: [],
  parseRemoteUrl: () => null,
  isConfigured: () => true,
  matchesUser: (identifier, config) => identifier === config.email,
  fetchPullRequests: async () => ({}),
  getPullRequestUrl: () => '',
};

const mockConfig: AppConfig = {
  email: 'me@test.com',
  vendorAuth: {},
  vendorProject: {},
};

function makePr(
  overrides: Partial<PullRequestInfo> & { id: number }
): PullRequestInfo {
  return {
    title: `PR #${overrides.id}`,
    sourceBranch: `feature/branch-${overrides.id}`,
    targetBranch: 'main',
    url: '',
    createdByIdentifier: 'me@test.com',
    createdByDisplayName: 'Me',
    ...overrides,
  };
}

describe('findOrphanPrs', () => {
  it('returns PRs whose branch no worktree has checked out', () => {
    const prMap: BranchPrMap = {
      'feature/branch-1': makePr({ id: 1 }),
      'feature/branch-2': makePr({ id: 2 }),
      'feature/branch-3': makePr({ id: 3 }),
    };
    const checkedOut = new Set(['feature/branch-2']);

    const result = findOrphanPrs(prMap, checkedOut, mockConfig, mockProvider);
    expect(result.map((p) => p.id)).toEqual([3, 1]); // sorted descending
  });

  it('excludes PRs from other users', () => {
    const prMap: BranchPrMap = {
      'feature/branch-1': makePr({
        id: 1,
        createdByIdentifier: 'other@test.com',
      }),
    };
    const result = findOrphanPrs(prMap, new Set(), mockConfig, mockProvider);
    expect(result).toEqual([]);
  });

  it('handles null entries in prMap', () => {
    const prMap: BranchPrMap = {
      'feature/branch-1': null,
    };
    const result = findOrphanPrs(prMap, new Set(), mockConfig, mockProvider);
    expect(result).toEqual([]);
  });
});

describe('categorizeReviews', () => {
  it('categorizes PRs by reviewer decision', () => {
    const prMap: BranchPrMap = {
      'branch-a': makePr({
        id: 1,
        createdByIdentifier: 'other@test.com',
        reviewers: [
          {
            displayName: 'Me',
            identifier: 'me@test.com',
            decision: 'no-response',
          },
        ],
      }),
      'branch-b': makePr({
        id: 2,
        createdByIdentifier: 'other@test.com',
        reviewers: [
          {
            displayName: 'Me',
            identifier: 'me@test.com',
            decision: 'approved',
          },
        ],
      }),
      'branch-c': makePr({
        id: 3,
        createdByIdentifier: 'other@test.com',
        reviewers: [
          {
            displayName: 'Me',
            identifier: 'me@test.com',
            decision: 'changes-requested',
          },
        ],
      }),
    };

    const result = categorizeReviews(prMap, mockConfig, mockProvider);
    expect(result.needsReview.map((p) => p.id)).toEqual([1]);
    expect(result.approvedByYou.map((p) => p.id)).toEqual([2]);
    expect(result.waitingForAuthor.map((p) => p.id)).toEqual([3]);
  });

  it('skips declined reviewers', () => {
    const prMap: BranchPrMap = {
      'branch-a': makePr({
        id: 1,
        createdByIdentifier: 'other@test.com',
        reviewers: [
          {
            displayName: 'Me',
            identifier: 'me@test.com',
            decision: 'declined',
          },
        ],
      }),
    };
    const result = categorizeReviews(prMap, mockConfig, mockProvider);
    expect(result.needsReview).toEqual([]);
    expect(result.approvedByYou).toEqual([]);
    expect(result.waitingForAuthor).toEqual([]);
  });

  it('excludes PRs created by the current user', () => {
    const prMap: BranchPrMap = {
      'branch-a': makePr({
        id: 1,
        createdByIdentifier: 'me@test.com',
        reviewers: [
          {
            displayName: 'Me',
            identifier: 'me@test.com',
            decision: 'no-response',
          },
        ],
      }),
    };
    const result = categorizeReviews(prMap, mockConfig, mockProvider);
    expect(result.needsReview).toEqual([]);
    expect(result.approvedByYou).toEqual([]);
    expect(result.waitingForAuthor).toEqual([]);
  });

  it('skips PRs where user is not a reviewer', () => {
    const prMap: BranchPrMap = {
      'branch-a': makePr({
        id: 1,
        createdByIdentifier: 'other@test.com',
        reviewers: [
          {
            displayName: 'Other',
            identifier: 'other@test.com',
            decision: 'no-response',
          },
        ],
      }),
    };
    const result = categorizeReviews(prMap, mockConfig, mockProvider);
    expect(result.needsReview).toEqual([]);
  });

  /**
   * A draft is the author saying the branch is not ready to be looked
   * at. Listing it under "Needs Your Review" puts a job on the reviewer
   * that they cannot clear — reviewing it does not remove it, because
   * the author has not asked yet.
   */
  it('keeps a draft out of "needs review"', () => {
    const prMap: BranchPrMap = {
      'branch-a': makePr({
        id: 1,
        isDraft: true,
        createdByIdentifier: 'other@test.com',
        reviewers: [
          {
            displayName: 'Me',
            identifier: 'me@test.com',
            decision: 'no-response',
          },
        ],
      }),
    };
    const result = categorizeReviews(prMap, mockConfig, mockProvider);
    expect(result.needsReview).toEqual([]);
    expect(result.waitingForAuthor).toEqual([]);
    expect(result.approvedByYou).toEqual([]);
  });

  it('still lists a ready PR that is otherwise identical', () => {
    // Guards the filter against widening into "drop every review PR".
    const prMap: BranchPrMap = {
      'branch-a': makePr({
        id: 1,
        isDraft: false,
        createdByIdentifier: 'other@test.com',
        reviewers: [
          {
            displayName: 'Me',
            identifier: 'me@test.com',
            decision: 'no-response',
          },
        ],
      }),
    };
    expect(
      categorizeReviews(prMap, mockConfig, mockProvider).needsReview
    ).toHaveLength(1);
  });

  it('keeps a draft you have already ruled on, in its own bucket', () => {
    // Both remaining buckets record a decision the reviewer made, so a
    // draft belongs there: "Waiting for Author" is precisely where a PR
    // sent back to draft after changes were requested should sit.
    const prMap: BranchPrMap = {
      'branch-a': makePr({
        id: 1,
        isDraft: true,
        createdByIdentifier: 'other@test.com',
        reviewers: [
          {
            displayName: 'Me',
            identifier: 'me@test.com',
            decision: 'changes-requested',
          },
        ],
      }),
      'branch-b': makePr({
        id: 2,
        isDraft: true,
        createdByIdentifier: 'other@test.com',
        reviewers: [
          {
            displayName: 'Me',
            identifier: 'me@test.com',
            decision: 'approved',
          },
        ],
      }),
    };
    const result = categorizeReviews(prMap, mockConfig, mockProvider);
    expect(result.waitingForAuthor.map((p) => p.id)).toEqual([1]);
    expect(result.approvedByYou.map((p) => p.id)).toEqual([2]);
  });
});

describe('buildSessionPrMap', () => {
  it('maps each session to the PR of the branch checked out in it', () => {
    const pr1 = makePr({ id: 1, sourceBranch: 'feature/foo' });
    const prMap: BranchPrMap = {
      'feature/foo': pr1,
      'feature/bar': null,
    };

    const foo = worktreeSessionKey('/wt/foo');
    const bar = worktreeSessionKey('/wt/bar');
    const sessionPrMap = buildSessionPrMap(prMap, [
      { name: foo, running: true, branch: 'feature/foo', path: '/wt/foo' },
      { name: bar, running: false, branch: 'feature/bar', path: '/wt/bar' },
    ]);
    expect(sessionPrMap.get(foo)).toBe(pr1);
    expect(sessionPrMap.has(bar)).toBe(false);
  });
});
