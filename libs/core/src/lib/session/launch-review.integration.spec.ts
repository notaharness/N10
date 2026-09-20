import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@n10/vcs-core';
import { orchestraFixture } from '../../../tests/orchestra-fixture.js';
import * as repoRoot from '../repo-root.js';
import { observeTmuxSessions } from '../session-backend.js';
import { ORCHESTRA_TAG } from '../session-identity.js';
import { listOurSessions } from '../session-resolver.js';
import { worktreeSessionKey } from '../session-key.js';
import { launchSession } from './launch-session.js';
import { buildBackgroundReviewRequest } from './review-prompt.js';
import { findReviewSession, launchReviewSession } from './launch-review.js';

/**
 * A review runs beside the branch's own agent, in the same checkout.
 * These are the two claims that only a real tmux server and a real git
 * repository can settle: that the two sessions coexist, and that
 * nothing reads the review as the agent that owns the branch.
 */
describe.skipIf(spawnSync('tmux', ['-V']).status !== 0)(
  'a background review beside a working agent',
  () => {
    let fixture: ReturnType<typeof orchestraFixture>;
    const config = {
      agentId: 'claude',
      vendorAuth: {},
      vendorProject: {},
    } as AppConfig;

    beforeEach(() => {
      fixture = orchestraFixture();
      vi.spyOn(repoRoot, 'getRepoRoot').mockReturnValue(fixture.repo);
    });
    afterEach(() => {
      fixture?.close();
      vi.restoreAllMocks();
    });

    const pr = {
      id: 42,
      title: 'Add a thing',
      sourceBranch: 'main',
      targetBranch: 'master',
      createdByDisplayName: 'Ada',
    };

    /** The launch a review actually makes, prompt builder included. */
    const review = (machine?: { configDir?: string }) =>
      launchReviewSession({
        repo: fixture.repo,
        branch: 'main',
        pullRequest: String(pr.id),
        cwd: fixture.repo,
        cols: 80,
        rows: 24,
        config,
        request: buildBackgroundReviewRequest(pr),
        machine,
      });

    const started = async () => {
      await expect
        .poll(() => existsSync(join(fixture.home, 'agent-start.json')))
        .toBe(true);
      return JSON.parse(fixture.read('agent-start.json')) as {
        args: string[];
        pid: number;
        env: Record<string, string | null>;
      };
    };

    it('runs in its own session, leaving the branch agent alone', async () => {
      const worktree = await launchSession({
        name: worktreeSessionKey('main', fixture.repo),
        cwd: fixture.repo,
        cols: 80,
        rows: 24,
        config,
        request: { intent: 'blank' },
      });
      const reviewEntry = await review();

      expect(reviewEntry.pty.name).not.toBe(worktree.pty.name);
      expect(worktree.exited).toBe(false);
      const tagged = findReviewSession(fixture.repo, '42');
      expect(tagged?.name).toBe(reviewEntry.pty.name);
      expect(tagged?.type).toBe('agent');
      expect(tagged?.branch).toBe('main');
    });

    it('is never read as the branch player, however it is tagged', async () => {
      // `observeTmuxSessions` reports a `worktree` session on a known
      // branch as that worktree's live agent. The review carries the
      // same branch tag and must not be counted there — doing so would
      // tell the UI an agent is running on a branch that has none.
      await review();
      const seen = observeTmuxSessions([
        {
          name: worktreeSessionKey('main', fixture.repo),
          branch: 'main',
          path: fixture.repo,
        },
      ]);
      expect([...seen.persisted]).toEqual([]);
      expect(seen.terminals).toHaveLength(1);
      expect(seen.terminals[0]).toMatchObject({ kind: 'agent', review: '42' });
    });

    it('launches the agent unattended, with its own git index', async () => {
      await review();
      const start = await started();
      expect(start.args[0]).toBe('--print');
      expect(start.args).toContain('--allowedTools');
      expect(start.env.GIT_OPTIONAL_LOCKS).toBe('0');
      expect(start.env.GIT_INDEX_FILE).toBeTruthy();
      expect(start.env.GIT_INDEX_FILE).not.toBe(
        join(fixture.repo, '.git', 'index')
      );
    });

    it('passes nothing that would void the tool allowlist', async () => {
      // `--allowedTools` is only a ceiling while nothing alongside it
      // waives permission checks. Asserted on the argv the agent was
      // actually started with, not on what the builder meant to send,
      // because this is the claim the whole read-only story rests on.
      await review();
      const { args } = await started();
      for (const waiver of [
        '--dangerously-skip-permissions',
        '--permission-mode',
        '--permissionMode',
      ]) {
        expect(args).not.toContain(waiver);
      }
      // And the git entries name subcommands: `Bash(git *)` would let
      // `git stash` through and undo the isolation above.
      const tools = args.slice(
        args.indexOf('--allowedTools') + 1,
        args.length - 1
      );
      expect(tools.filter((t) => /^Bash\(git\s*\*?\)$/.test(t))).toEqual([]);
      expect(tools).not.toContain('Bash');
      expect(tools).toContain('Bash(git diff:*)');
    });

    it('expands the chosen config directory against the running home', async () => {
      // The token crosses as written and becomes a path here, on the
      // machine about to run the agent — which is why the value that
      // arrives is under this fixture's home and not the developer's.
      await review({ configDir: '~/.claude' });
      const start = await started();
      expect(start.env.CLAUDE_CONFIG_DIR).toBe(join(fixture.home, '.claude'));
    });

    it('sends no config directory when none was chosen', async () => {
      await review();
      const start = await started();
      expect(start.env.CLAUDE_CONFIG_DIR).toBeNull();
    });

    it('replaces the previous review of the same pull request', async () => {
      // What bounds retained sessions: reviewing a pull request twenty
      // times leaves one session behind, not twenty. The label is free
      // again once the old session is gone, so the replacement reusing
      // it is the expected outcome rather than a collision.
      await review();
      const first = await started();
      rmSync(join(fixture.home, 'agent-start.json'));
      const second = await review();
      const next = await started();

      expect(next.pid).not.toBe(first.pid);
      const reviews = listOurSessions().filter(
        (s) => s.review === '42' && s.repo === fixture.repo
      );
      expect(reviews).toHaveLength(1);
      expect(reviews[0].name).toBe(second.pty.name);
    });

    it('tags the session so Orchestra cannot read it as a player', async () => {
      const entry = await review();
      const value = (tag: string) =>
        fixture
          .tmux('show-options', '-v', '-t', `=${entry.pty.name}:`, tag)
          .trim();
      expect(value(ORCHESTRA_TAG.sessionType)).toBe('agent');
      expect(value(ORCHESTRA_TAG.review)).toBe('42');
      expect(value(ORCHESTRA_TAG.branch)).toBe('main');
    });
  }
);
