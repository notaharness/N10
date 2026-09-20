import { describe, it, expect } from 'vitest';
import {
  CONVENTIONAL_DECORATIONS,
  CONVENTIONAL_LABELS,
} from '@n10/review-comments';
import {
  BACKGROUND_REVIEW_TOOLS,
  buildBackgroundReviewRequest,
  buildReviewLaunchRequest,
} from './review-prompt.js';

const pr = {
  id: 42,
  title: 'Add "quoted" feature',
  sourceBranch: 'feat/x',
  targetBranch: 'main',
  createdByDisplayName: 'Ada',
};

describe('buildReviewLaunchRequest', () => {
  it('seeds or continues a review with the add-comment guidance', () => {
    const req = buildReviewLaunchRequest(pr);
    expect(req.intent).toBe('continue-or-seed');
    expect(req.prompt).toContain('Review PR #42 ("Add "quoted" feature")');
    expect(req.prompt).toContain('feat/x → main');
    expect(req.prompt).toContain('by Ada');
    expect(req.systemGuidance).toContain('n10 util add-comment --pr=42');
    expect(req.prompt).not.toContain('ADDITIONAL USER INSTRUCTION');
  });

  it('appends a trimmed additional instruction', () => {
    const req = buildReviewLaunchRequest(pr, '  focus on error handling  ');
    expect(req.prompt).toMatch(
      /ADDITIONAL USER INSTRUCTION \(overrides previous where applicable\): focus on error handling$/
    );
  });

  it('falls back to the branch name when the title is empty', () => {
    const req = buildReviewLaunchRequest({ ...pr, title: '' });
    expect(req.prompt).toContain('Review PR #42 ("feat/x")');
  });

  /**
   * The guidance is the agent's only spec for what a comment looks
   * like — it is a fresh process with no memory of the last review — so
   * anything the poster and the viewer expect has to be stated here.
   */
  describe('the comment-writing guidance', () => {
    const guidance = () => buildReviewLaunchRequest(pr).systemGuidance ?? '';

    it('names every label and decoration the parser accepts', () => {
      for (const label of CONVENTIONAL_LABELS) {
        expect(guidance()).toContain(label);
      }
      for (const decoration of CONVENTIONAL_DECORATIONS) {
        expect(guidance()).toContain(decoration);
      }
    });

    it('gives the shape, and where the reasoning goes', () => {
      expect(guidance()).toContain('<label> [decorations]: <subject>');
      expect(guidance()).toContain('conventionalcomments.org');
    });

    /** The attribution is added at post time. An agent that signs its
     *  own comments produces two signatures on one comment. */
    it('tells the agent not to sign its own comments', () => {
      expect(guidance()).toMatch(/[Dd]o not sign the comment/);
    });

    it('says where thread ids come from', () => {
      expect(guidance()).toContain('--thread=<id>');
      expect(guidance()).toContain('(thread <id>)');
    });
  });

  describe('buildBackgroundReviewRequest', () => {
    const req = () => buildBackgroundReviewRequest(pr);

    it('runs to completion instead of taking over a live session', () => {
      expect(req().intent).toBe('headless');
      expect(buildReviewLaunchRequest(pr).intent).toBe('continue-or-seed');
    });

    it('asks for the same review as the interactive one', () => {
      expect(req().prompt).toBe(buildReviewLaunchRequest(pr).prompt);
    });

    it('keeps the add-comment guidance', () => {
      expect(req().systemGuidance).toContain('n10 util add-comment');
    });

    it('allows reading and commenting, and nothing that writes the tree', () => {
      const tools = req().allowedTools ?? [];
      expect(tools).toEqual(BACKGROUND_REVIEW_TOOLS);
      expect(tools).toContain('Bash(n10 util add-comment:*)');
      expect(tools).toContain('Read');
      for (const forbidden of ['Write', 'Edit', 'Bash(git add:*)']) {
        expect(tools).not.toContain(forbidden);
      }
      // A bare `Bash` would readmit everything the list leaves out.
      expect(tools).not.toContain('Bash');
    });

    it('says it is unattended and sharing the checkout', () => {
      const guidance = req().systemGuidance ?? '';
      expect(guidance).toMatch(/another agent may be editing/);
      expect(guidance).toMatch(/do not ask one/i);
      expect(guidance).toMatch(/Do not modify, create or delete any file/);
    });
  });
});
