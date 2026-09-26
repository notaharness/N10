import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { test, expect } from './fixtures/n10.js';
import { createSession } from './setup/sessions.js';
import { settleFor } from './setup/waits.js';

/**
 * A worktree session belongs to its checkout: `git switch` inside the
 * worktree relabels its sidebar row, and the agent running there stays
 * that row's — still running, still on screen — rather than being left
 * behind under the branch it was started on.
 */

const MARKER = 'n10-branch-switch-agent';

test.use({
  n10Config: {
    aiCommand: `echo ${MARKER} && sleep 300`,
    keybindPreset: 'vim',
  },
});

test('switching branch inside a worktree keeps its row and its agent', async ({
  n10,
}) => {
  const branch = 'e2e-switch-from';
  const other = 'e2e-switch-to';
  await createSession(n10.term, branch, { start: true });
  await expect(n10.term.getByText(MARKER).first()).toBeVisible({
    timeout: 15_000,
  });
  // The launch re-reads the rows once it lands; let that happen first,
  // so only noticing the switch itself can relabel the row.
  await settleFor(
    n10.term.page,
    3_000,
    'the refresh that follows starting the session'
  );

  execFileSync('git', ['switch', '-c', other], {
    cwd: join(n10.repoPath, '.claude', 'worktrees', branch),
    stdio: 'ignore',
  });

  // The row follows the checkout onto the new branch…
  await expect(n10.term.getByText(other).first()).toBeVisible({
    timeout: 15_000,
  });
  // …and the agent is still the one behind it.
  await expect(n10.term.getByText(MARKER).first()).toBeVisible();
  await expect(n10.term.getByText('(no sessions)')).toHaveCount(0);
});
