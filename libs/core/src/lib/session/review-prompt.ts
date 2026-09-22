import type { PullRequestInfo } from '@n10/vcs-core';
import {
  CONVENTIONAL_DECORATIONS,
  CONVENTIONAL_LABELS,
} from '@n10/review-comments';
import type { LaunchRequest } from './launch-session.js';

/**
 * The launch request for an AI review session of a PR — shared by every
 * shell (TUI, desktop) so the agent always gets the same task prompt
 * and the same `n10 util add-comment` guidance.
 *
 * Resumes an existing review conversation in the worktree when the
 * agent supports it, otherwise seeds a fresh session with the prompt.
 */
export function buildReviewLaunchRequest(
  pr: Pick<
    PullRequestInfo,
    'id' | 'title' | 'sourceBranch' | 'targetBranch' | 'createdByDisplayName'
  >,
  additionalInstruction?: string
): LaunchRequest {
  // Reusable how-to guidance (installed as a system prompt for agents
  // that support it, e.g. Claude; folded into the prompt otherwise).
  const systemGuidance =
    `To add review comments, use this command:\n` +
    `  n10 util add-comment --pr=${pr.id} --file=<path> --lineStart=<n> --lineEnd=<n> --severity=<critical|major|minor|nit> --body="<comment>"\n\n` +
    `Rules:\n` +
    `- File paths are relative to the repo root\n` +
    `- lineStart/lineEnd are 1-based line numbers in the NEW version of the file\n` +
    `- Use --side=LEFT only when commenting on removed/deleted lines\n` +
    `- Severity: critical (blocks merge), major (should fix), minor (nice to fix), nit (style/preference)\n` +
    `- Add --thread=<id> to record which existing review thread a comment ` +
    `is about. It is still posted as a new comment at --file/--lineStart, ` +
    `not as a reply in that thread — the id is there so the reader can see ` +
    `which conversation you had in mind. Thread ids come from the review ` +
    `data you are given (a plan prompt names each one as "(thread <id>)"); ` +
    `they are the provider's own ids and are the only way to say which ` +
    `conversation you mean.\n` +
    `- Comments appear live in the reviewer's diff viewer\n\n` +
    `Write each --body as a Conventional Comment (conventionalcomments.org):\n` +
    `  <label> [decorations]: <subject>\n` +
    `\n` +
    `  <discussion>\n\n` +
    `- Labels: ${CONVENTIONAL_LABELS.join(', ')}\n` +
    `- Decorations, in parentheses and comma-separated: ` +
    `${CONVENTIONAL_DECORATIONS.join(', ')}\n` +
    `- The subject is one line saying the thing; the discussion below the ` +
    `blank line is where the reasoning, the evidence and any code go\n` +
    `- Write the header yourself when you have a better one than the ` +
    `severity implies (e.g. "question (blocking):"); a body without one ` +
    `is given the header its severity maps to. The louder of the two ` +
    `wins, so do not open a comment with a label word unless you mean ` +
    `it as the label — "Note: ..." on a critical finding is read as the ` +
    `sentence it is, not as a downgrade\n` +
    `- Do not sign the comment or say it came from an AI — that is added ` +
    `when it is posted`;

  let prompt =
    `Review PR #${pr.id} ("${pr.title || pr.sourceBranch}") ` +
    `merging ${pr.sourceBranch} → ${pr.targetBranch} ` +
    `by ${pr.createdByDisplayName || 'unknown'}.\n\n` +
    `Review all changed files thoroughly. Add comments for any issues found.`;

  const extra = additionalInstruction?.trim();
  if (extra) {
    prompt +=
      ` ADDITIONAL USER INSTRUCTION (overrides previous where applicable): ` +
      extra;
  }

  return { intent: 'continue-or-seed', prompt, systemGuidance };
}

/**
 * The same review, run in a session of its own.
 *
 * The request above resumes the worktree's own conversation, which is
 * the right thing when the review *is* that session. A background
 * review is a second session in the same checkout, so it always starts
 * a fresh conversation: `--continue` there would resume whatever the
 * working agent was last saying, not a prior review.
 *
 * The reviewer shares the worktree with that agent and is an ordinary
 * interactive session — nothing stops it writing. The guidance below
 * asks it not to; it does not prevent it, and the PR says as much.
 */
export function buildBackgroundReviewRequest(
  pr: Parameters<typeof buildReviewLaunchRequest>[0],
  additionalInstruction?: string
): LaunchRequest {
  const base = buildReviewLaunchRequest(pr, additionalInstruction);
  return {
    intent: 'seed',
    prompt: base.prompt,
    systemGuidance: `${base.systemGuidance ?? ''}\n\n${SHARED_WORKTREE_RULES}`,
  };
}

const SHARED_WORKTREE_RULES =
  `You are reviewing in a worktree that another agent may be editing at ` +
  `the same time, in a session beside yours.\n\n` +
  `- Read and review; do not modify, create or delete files in the checkout\n` +
  `- Do not run git commands that write: no add, commit, checkout, switch, ` +
  `stash, reset, merge or rebase\n` +
  `- The tree may change under you while you read it. Review what you see ` +
  `and say so if it shifts; do not try to stop it changing`;
