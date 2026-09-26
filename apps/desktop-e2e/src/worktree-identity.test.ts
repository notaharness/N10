import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/desktop.js';
import {
  createWorktree,
  launchAgentFromRail,
  sidebarRow,
  tab,
  tabs,
  visibleText,
} from './setup/app.js';
import { cleanupExternalSessions, tmuxAvailable } from './setup/external.js';
import { listTaggedSessions } from './setup/tmux.js';

/**
 * A worktree session belongs to its checkout. The agent in it stays
 * behind the worktree's tab through a branch rename and across a
 * restart of the app, and a second worktree
 * that checks the original branch out again gets no agent of its own.
 */

const BANNER_NAME = 'Branch switched';

function banner(page: Page) {
  return page.getByRole('status', { name: BANNER_NAME });
}

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

async function launchInWorktree(page: Page, branch: string): Promise<void> {
  await createWorktree(page, branch);
  await launchAgentFromRail(page);
  await expect(visibleText(page, 'n10-fake-agent-ready')).toBeVisible({
    timeout: 30_000,
  });
}

test.describe('A worktree session belongs to its checkout', () => {
  const BRANCH = 'feature';

  test('tags the session with its checkout', async ({ desktop }) => {
    const { page, repoPath, homeDir } = desktop;
    await launchInWorktree(page, BRANCH);
    const worktree = realpathSync(
      join(repoPath, '.claude', 'worktrees', BRANCH)
    );
    expect(
      listTaggedSessions(homeDir).find((s) => s.type === 'worktree')
    ).toMatchObject({ branch: BRANCH, worktreePath: worktree });
  });

  test('keeps its agent through a branch rename', async ({ desktop }) => {
    const { page, repoPath } = desktop;
    await launchInWorktree(page, BRANCH);
    git(
      join(repoPath, '.claude', 'worktrees', BRANCH),
      'branch',
      '-m',
      'renamed'
    );

    await expect(tab(page, /renamed/)).toBeVisible({ timeout: 15_000 });
    await expect(tabs(page)).toHaveCount(1);
    await expect(banner(page)).toContainText('renamed');
    await expect(visibleText(page, 'n10-fake-agent-ready')).toBeVisible();
    await expect(sidebarRow(page, /renamed/)).toBeVisible();
  });

  test('gives a second worktree on the original branch no agent', async ({
    desktop,
  }) => {
    const { page, repoPath } = desktop;
    await launchInWorktree(page, BRANCH);
    git(
      join(repoPath, '.claude', 'worktrees', BRANCH),
      'switch',
      '-c',
      'other'
    );
    await expect(tab(page, /other/)).toBeVisible({ timeout: 15_000 });

    // `feature` is free again, so another checkout can take it.
    const again = join(repoPath, '.claude', 'worktrees', 'feature-again');
    git(repoPath, 'worktree', 'add', again, BRANCH);
    await expect(sidebarRow(page, /^feature$/)).toBeVisible({
      timeout: 15_000,
    });

    // The agent is still the switched worktree's, and only its.
    const sessions = await page.evaluate(() => window.n10.listSessions());
    expect(sessions.filter((s) => s.running)).toHaveLength(1);
    const [running] = sessions.filter((s) => s.running);
    expect(JSON.parse(running.name)[2]).toBe(
      realpathSync(join(repoPath, '.claude', 'worktrees', BRANCH))
    );
    await sidebarRow(page, /^feature$/).click();
    await expect(
      page.getByRole('button', { name: 'Launch agent', exact: true })
    ).toBeVisible({ timeout: 15_000 });
  });
});

/**
 * The app starts on an agent that was already running in a worktree
 * whose branch was switched while n10 was closed — a restart.
 */
test.describe('After a restart, a switched worktree’s session', () => {
  const SEEDED = 'e2e-ext-seeded';
  const MOVED = 'e2e-ext-moved';
  test.skip(!tmuxAvailable(), 'tmux is not installed');
  test.use({
    liveSessions: [
      {
        branch: SEEDED,
        command: `printf '%s\\n' restored-agent-here; sleep 300`,
        switchTo: MOVED,
      },
    ],
  });
  test.afterEach(({ desktop }) => {
    cleanupExternalSessions(desktop.repoPath, [SEEDED, MOVED], desktop.homeDir);
  });

  test('comes back behind the worktree’s tab', async ({ desktop }) => {
    const { page } = desktop;
    await expect(tab(page, new RegExp(MOVED))).toBeVisible({ timeout: 30_000 });
    await expect(tabs(page)).toHaveCount(1);
    await expect(visibleText(page, 'restored-agent-here')).toBeVisible({
      timeout: 15_000,
    });
    await expect(banner(page)).toContainText(MOVED);
    await expect(banner(page)).toContainText(SEEDED);
    // Not an orphan agent terminal as well.
    await expect(
      page.locator('[role="tab"][data-face="terminal"]')
    ).toHaveCount(0);
  });
});
