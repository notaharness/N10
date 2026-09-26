import type { PullRequestInfo } from '@n10/vcs-core';
import {
  HOME,
  TEAMMATE,
  VIEWER,
  babysitting,
  prUrl,
  sessionKey,
  type RepoData,
} from './identity.js';
import { n10Threads } from './threads.js';

/**
 * n10 itself, as it stood while these pull requests were in flight.
 * Titles, branches, descriptions and diffs are the real ones; the
 * reviewer on #177 and the author of #175 stand in for a teammate.
 */
export const N10 = `${HOME}/code/n10`;
const SLUG = 'notaharness/n10';

export const PR_FLEET: PullRequestInfo = {
  id: 182,
  title: 'feat(desktop): move Fleet into the sidebar',
  sourceBranch: 'feat/fleet-sidebar',
  targetBranch: 'master',
  url: prUrl(SLUG, 182),
  createdByIdentifier: VIEWER,
  createdByDisplayName: VIEWER,
  isDraft: true,
  activeCommentCount: 0,
  buildStatus: 'pending',
  headSha: 'aaf0a2be3f1c8d0e5b7a9c4d2e6f8a1b3c5d7e9f',
};

export const PR_TABS: PullRequestInfo = {
  id: 177,
  title: "fix(desktop): keep a worktree's tab when its branch switches",
  sourceBranch: 'fix/tab-branch-switch',
  targetBranch: 'master',
  url: prUrl(SLUG, 177),
  createdByIdentifier: VIEWER,
  createdByDisplayName: VIEWER,
  reviewers: [
    {
      displayName: TEAMMATE,
      identifier: TEAMMATE,
      decision: 'changes-requested',
    },
  ],
  activeCommentCount: 2,
  buildStatus: 'failed',
  headSha: '905bbcb2036a4f1e8c2d7b9a5e3f6c1d8b4a2e7f',
};

const PR_LINUX: PullRequestInfo = {
  id: 171,
  title: 'feat(desktop): Linux .deb and AppImage installers',
  sourceBranch: 'feat/linux-packages',
  targetBranch: 'master',
  url: prUrl(SLUG, 171),
  createdByIdentifier: VIEWER,
  createdByDisplayName: VIEWER,
  reviewers: [
    { displayName: TEAMMATE, identifier: TEAMMATE, decision: 'approved' },
  ],
  activeCommentCount: 0,
  buildStatus: 'succeeded',
  headSha: 'c41e7d09b2a85f3e6d1c9b7a4e2f8d5c3b1a9e7d',
};

export const PR_REVIEW: PullRequestInfo = {
  id: 175,
  title:
    'feat(desktop): open the comments at the first unresolved thread from the PR header',
  sourceBranch: 'feat/unresolved-opens-comments',
  targetBranch: 'master',
  url: prUrl(SLUG, 175),
  createdByIdentifier: TEAMMATE,
  createdByDisplayName: TEAMMATE,
  reviewers: [
    { displayName: VIEWER, identifier: VIEWER, decision: 'no-response' },
  ],
  activeCommentCount: 0,
  buildStatus: 'succeeded',
  headSha: '69830d8d53e1f7a2c4b6d8e0f2a4c6e8d0b2a4c6',
};

export const N10_REPO: RepoData = {
  cwd: N10,
  slug: SLUG,
  defaultBranch: 'master',
  branches: [
    'master',
    'docs/roadmap',
    PR_FLEET.sourceBranch,
    PR_TABS.sourceBranch,
    PR_LINUX.sourceBranch,
    PR_REVIEW.sourceBranch,
  ],
  worktrees: ['docs/roadmap', PR_FLEET.sourceBranch, PR_TABS.sourceBranch],
  sidebar: () => [
    {
      kind: 'session',
      session: { name: sessionKey(N10, 'docs/roadmap'), running: false },
      branch: 'docs/roadmap',
      isMerged: false,
    },
    {
      kind: 'session',
      session: { name: sessionKey(N10, PR_FLEET.sourceBranch), running: true },
      branch: PR_FLEET.sourceBranch,
      pr: PR_FLEET,
      isMerged: false,
    },
    {
      kind: 'session',
      session: { name: sessionKey(N10, PR_TABS.sourceBranch), running: false },
      branch: PR_TABS.sourceBranch,
      pr: PR_TABS,
      isMerged: false,
      babysit: babysitting(PR_TABS),
    },
    { kind: 'orphan-pr', pr: PR_LINUX },
    { kind: 'review-pr', pr: PR_REVIEW, category: 'needs-review' },
  ],
  threads: () => n10Threads(PR_TABS.id),
  diffs: {
    [PR_FLEET.sourceBranch]: () => import('./diffs/pr-182.diff?raw'),
    [PR_TABS.sourceBranch]: () => import('./diffs/pr-177.diff?raw'),
    [PR_REVIEW.sourceBranch]: () => import('./diffs/pr-175.diff?raw'),
  },
  descriptions: {
    171: () => import('./descriptions/pr-171.md?raw'),
    175: () => import('./descriptions/pr-175.md?raw'),
    177: () => import('./descriptions/pr-177.md?raw'),
    182: () => import('./descriptions/pr-182.md?raw'),
  },
};
