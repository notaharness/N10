import { test, expect } from './fixtures/desktop.js';
import { createWorktree, tab } from './setup/app.js';
import {
  addExternalWorktree,
  cleanupExternalSessions,
  startExternalTmuxSession,
  tmuxAvailable,
  uniqueExternalBranch,
} from './setup/external.js';

/**
 * Where focus goes when a worktree tab appears: to it when the user
 * created it, and nowhere when it was created outside the app — a
 * shell's `git worktree add` plus a tmux session, the way an
 * orchestrator spawns a player. The outside one opens behind the
 * active tab, marked unseen until it is first opened.
 */
test.skip(!tmuxAvailable(), 'tmux is not installed');

test.describe('Tabs for work created outside the app', () => {
  let branches: string[] = [];

  test.beforeEach(() => {
    branches = [];
  });

  test.afterEach(({ desktop }) => {
    cleanupExternalSessions(desktop.repoPath, branches, desktop.homeDir);
  });

  test('a worktree created through the UI opens and focuses its tab', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await createWorktree(page, 'alpha');
    await expect(tab(page, /alpha/)).toHaveAttribute('aria-selected', 'true');

    // With another tab in front, the new one still takes focus.
    await createWorktree(page, 'beta');
    await expect(tab(page, /beta/)).toHaveAttribute('aria-selected', 'true');
    await expect(tab(page, /alpha/)).toHaveAttribute('aria-selected', 'false');
    await expect(tab(page, /beta/)).not.toHaveAttribute('data-unseen');
  });

  test('a worktree and session created from a shell open in the background', async ({
    desktop,
  }) => {
    const { page, repoPath, homeDir } = desktop;
    await createWorktree(page, 'alpha');
    const active = tab(page, /alpha/);
    await expect(active).toHaveAttribute('aria-selected', 'true');

    const branch = uniqueExternalBranch();
    branches.push(branch);
    const worktreePath = addExternalWorktree(repoPath, branch);
    startExternalTmuxSession({
      repoPath,
      homeDir,
      branch,
      worktreePath,
      command: 'sleep 120',
    });

    const background = tab(page, new RegExp(branch));
    await expect(background).toBeVisible({ timeout: 30_000 });
    await expect(background).toHaveAttribute('data-unseen', 'true');
    await expect(background).toHaveAttribute('aria-selected', 'false');
    await expect(active).toHaveAttribute('aria-selected', 'true');

    await background.click();
    await expect(background).toHaveAttribute('aria-selected', 'true');
    await expect(background).not.toHaveAttribute('data-unseen');
  });
});
