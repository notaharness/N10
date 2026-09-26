import type { PullRequestInfo } from '@n10/vcs-core';
import { REVIEW_DRAFTS } from '../../data/drafts.js';
import { displayDir } from '../../data/identity.js';
import { N10, PR_REVIEW } from '../../data/n10.js';
import type { RepoState } from '../../host/state.js';
import type { Beat, ClaudeScript } from './claude-code.js';

/**
 * The review agent n10 starts on a pull request. Its first turn is
 * core's review prompt (`buildReviewLaunchRequest`); it records each
 * finding with `n10 util add-comment`, which is what makes the drafts
 * appear in the diff viewer one by one while it works.
 */
const IDS = [
  '3f6b1c2e-8d4a-4f0e-9a51-7c2d9e6b4a10',
  'b81e0d47-2c93-4a6f-8e15-d4a7f3c90b22',
  '5ca9e3f1-6b72-4d18-a0c4-19e8b7d2f635',
  'e2d47a90-1f3c-4b85-9d6e-8a5c0f7b3e41',
];

function addComment(repo: RepoState, pr: PullRequestInfo, i: number): Beat {
  const draft = REVIEW_DRAFTS[i] as (typeof REVIEW_DRAFTS)[number];
  const id = IDS[i] ?? `draft-${i}`;
  const subject = draft.body.split('\n')[0] ?? '';
  return {
    after: 2600,
    effect: () => {
      repo.drafts[pr.id] = [
        ...(repo.drafts[pr.id] ?? []),
        { ...draft, id, status: 'draft', createdAt: new Date().toISOString() },
      ];
    },
    blocks: [
      {
        kind: 'tool',
        name: 'Bash',
        arg: `n10 util add-comment --pr=${pr.id} --file=${draft.file} --lineStart=${draft.lineStart} --lineEnd=${draft.lineEnd} --severity=${draft.severity} --body="${subject}…"`,
        out: [id],
      },
    ],
  };
}

/** Core's review prompt, as the agent's first turn shows it. */
function reviewPrompt(pr: PullRequestInfo) {
  return {
    kind: 'prompt' as const,
    text:
      `Review PR #${pr.id} ("${pr.title}") merging ${pr.sourceBranch} → ${pr.targetBranch} by ${pr.createdByDisplayName}.\n\n` +
      'Review all changed files thoroughly. Add comments for any issues found.',
  };
}

/** A pull request with no scripted findings: a clean read. */
function cleanReview(pr: PullRequestInfo, repo: RepoState): ClaudeScript {
  return {
    cwd: displayDir(repo.cwd, pr.sourceBranch),
    history: [reviewPrompt(pr)],
    beats: [
      {
        after: 700,
        working: 'Reviewing',
        blocks: [{ kind: 'read', files: 5 }],
      },
      {
        after: 5200,
        working: null,
        blocks: [
          {
            kind: 'say',
            paragraphs: [
              `I read every file in #${pr.id} and found nothing worth a draft. (In the demo, #175 is the pull request with findings.)`,
            ],
          },
          { kind: 'done', text: 'Worked for 38s' },
        ],
      },
    ],
  };
}

export function reviewScript(
  pr: PullRequestInfo,
  repo: RepoState
): ClaudeScript {
  if (repo.cwd !== N10 || pr.id !== PR_REVIEW.id) return cleanReview(pr, repo);
  return {
    cwd: displayDir(repo.cwd, pr.sourceBranch),
    history: [reviewPrompt(pr)],
    beats: [
      {
        after: 700,
        working: 'Reviewing',
        blocks: [
          {
            kind: 'tool',
            name: 'Bash',
            arg: `git diff --stat origin/${pr.targetBranch}...HEAD`,
            out: [
              ' .../src/unresolved-comments.test.ts           | 130 +++++++++++',
              ' .../components/review/PrHeader.tsx            |  43 ++++++--',
              ' .../lib/review/use-review-rail.ts             |  74 ++++++++++',
              [['… +5 lines (ctrl+o to expand)', ['gray']]],
              ' 8 files changed, 317 insertions(+), 33 deletions(-)',
            ],
          },
        ],
      },
      { after: 2600, blocks: [{ kind: 'read', files: 8 }] },
      ...REVIEW_DRAFTS.map((_, i) => addComment(repo, pr, i)),
      {
        after: 2400,
        working: null,
        blocks: [
          {
            kind: 'say',
            paragraphs: [
              'The feature does what it says: the count is a real button, and a click that lands before the threads load is held and replayed. I left four drafts, none blocking:',
              '1. `firstUnresolvedThread` relies on the rail being sorted by file and line.',
              '2. A single animation frame can be too early to find the row after unhiding the rail.',
              '3. A failed refetch drops the click silently.',
              "4. The button's label is announced twice.",
            ],
          },
          { kind: 'done', text: 'Crunched for 13s' },
        ],
      },
    ],
  };
}
