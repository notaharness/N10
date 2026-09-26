import type { PullRequestInfo } from '@n10/vcs-core';
import { HOME, VIEWER, prUrl, sessionKey, type RepoData } from './identity.js';
import { SERVER } from './machines.js';

/**
 * beam, n10's machine fleet, with its two open pull requests as they
 * really are. #39's agent runs on the rented server rather than this
 * laptop, which is how its tab shows a machine.
 */
export const BEAM = `${HOME}/code/beam`;
const SLUG = 'notaharness/beam';

export const PR_HOMEPAGE: PullRequestInfo = {
  id: 39,
  title: "feat(worker): beam.n10.is without a fragment is beam's homepage",
  sourceBranch: 'feat/homepage',
  targetBranch: 'main',
  url: prUrl(SLUG, 39),
  createdByIdentifier: VIEWER,
  createdByDisplayName: VIEWER,
  activeCommentCount: 0,
  buildStatus: 'pending',
  headSha: '5c9ea48f94a450cd7ad85657f1ac17d153759720',
};

const PR_PUBLISHING: PullRequestInfo = {
  id: 38,
  title:
    "chore(ci): npm trusted publishing, SECURITY.md and a newcomer's README",
  sourceBranch: 'feat/trusted-publishing-security',
  targetBranch: 'main',
  url: prUrl(SLUG, 38),
  createdByIdentifier: VIEWER,
  createdByDisplayName: VIEWER,
  activeCommentCount: 0,
  buildStatus: 'succeeded',
  headSha: '62fc69f4272e17c9bda06137f1a25fc09932ff53',
};

/** #39's agent session, qualified to the server it runs on. */
export const HOMEPAGE_SESSION = sessionKey(
  BEAM,
  PR_HOMEPAGE.sourceBranch,
  SERVER
);

export const BEAM_REPO: RepoData = {
  cwd: BEAM,
  slug: SLUG,
  defaultBranch: 'main',
  branches: [
    'main',
    'docs/relay-regions',
    PR_HOMEPAGE.sourceBranch,
    PR_PUBLISHING.sourceBranch,
  ],
  worktrees: ['docs/relay-regions', PR_HOMEPAGE.sourceBranch],
  sidebar: () => [
    {
      kind: 'session',
      session: { name: sessionKey(BEAM, 'docs/relay-regions'), running: false },
      branch: 'docs/relay-regions',
      isMerged: false,
    },
    {
      kind: 'session',
      session: { name: HOMEPAGE_SESSION, running: true },
      branch: PR_HOMEPAGE.sourceBranch,
      pr: PR_HOMEPAGE,
      isMerged: false,
    },
    { kind: 'orphan-pr', pr: PR_PUBLISHING },
  ],
  diffs: {
    [PR_HOMEPAGE.sourceBranch]: () => import('./diffs/beam-39.diff?raw'),
    [PR_PUBLISHING.sourceBranch]: () => import('./diffs/beam-38.diff?raw'),
  },
  descriptions: {
    39: () => import('./descriptions/beam-39.md?raw'),
    38: () => import('./descriptions/beam-38.md?raw'),
  },
};
