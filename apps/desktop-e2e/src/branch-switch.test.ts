import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/desktop.js';
import {
  createWorktree,
  focusTerminal,
  launchAgentFromRail,
  tab,
  tabs,
  visibleText,
} from './setup/app.js';

/**
 * A worktree is its directory, not its branch: `git switch` inside it
 * keeps its tab, relabels it, and keeps the agent running there behind
 * it. The tab warns while the worktree is off the branch it was opened
 * for.
 */

const BRANCH = 'feature';
const OTHER = 'other';

function banner(page: Page) {
  return page.getByRole('status', { name: 'Branch switched' });
}

function switchOutside(repoPath: string, ...args: string[]): void {
  execFileSync('git', ['switch', ...args], {
    cwd: join(repoPath, '.claude', 'worktrees', BRANCH),
    stdio: 'ignore',
  });
}

async function expectSwitched(page: Page): Promise<void> {
  await expect(tab(page, new RegExp(OTHER))).toBeVisible({ timeout: 15_000 });
  await expect(tabs(page)).toHaveCount(1);
  await expect(banner(page)).toContainText(OTHER);
  await expect(banner(page)).toContainText(BRANCH);
}

async function expectBack(page: Page): Promise<void> {
  await expect(tab(page, new RegExp(BRANCH))).toBeVisible({ timeout: 15_000 });
  await expect(tabs(page)).toHaveCount(1);
  await expect(banner(page)).toHaveCount(0);
}

test.describe('Switching branch inside a worktree', () => {
  test('from an outside shell keeps the tab and its agent, with a banner until switched back', async ({
    desktop,
  }) => {
    const { page, repoPath } = desktop;
    await createWorktree(page, BRANCH);
    await launchAgentFromRail(page);
    await expect(visibleText(page, 'n10-fake-agent-ready')).toBeVisible({
      timeout: 30_000,
    });
    await expect(banner(page)).toHaveCount(0);

    switchOutside(repoPath, '-c', OTHER);
    await expectSwitched(page);
    // The agent that was running in the worktree is still the one
    // behind its tab.
    await expect(visibleText(page, 'n10-fake-agent-ready')).toBeVisible();

    // A rebuilt strip finds the tab again through the agent running in
    // the worktree, still knowing the branch it was opened for.
    await page.reload();
    await expectSwitched(page);
    await expect(visibleText(page, 'n10-fake-agent-ready')).toBeVisible({
      timeout: 15_000,
    });

    switchOutside(repoPath, BRANCH);
    await expectBack(page);
  });

  test.describe('from n10’s own terminal', () => {
    // The worktree's agent is a plain shell, so the switch is typed
    // into the terminal n10 runs in the worktree.
    test.use({ n10Config: { aiCommand: 'sh' } });

    test('keeps the tab, relabels it, and clears the banner on switching back', async ({
      desktop,
    }) => {
      const { page } = desktop;
      await createWorktree(page, BRANCH);
      await launchAgentFromRail(page);
      await expect(
        page.locator('[data-terminal-pane]').getByText(/\S/).first()
      ).toBeVisible({ timeout: 15_000 });

      await focusTerminal(page);
      await page.keyboard.type(`git switch -c ${OTHER}\n`, { delay: 10 });
      await expectSwitched(page);

      await focusTerminal(page);
      await page.keyboard.type(`git switch ${BRANCH}\n`, { delay: 10 });
      await expectBack(page);
    });
  });
});
