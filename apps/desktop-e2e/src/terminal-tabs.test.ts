import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test, expect, fakeAgent } from './fixtures/desktop.js';
import {
  createWorktree,
  expectAdjoining,
  focusTerminal,
  openPalette,
  tab as tabNamed,
  visibleText,
} from './setup/app.js';
import { armFolderPick } from './setup/dialogs.js';
import { cleanupTestRepo, createTestRepo } from './setup/git-repo.js';
import {
  confirmNewTerminal,
  newTerminalDialog,
  openNewTerminalDialog,
  terminalTabs,
} from './setup/terminals.js';

/**
 * Terminal tabs: opened from the native menu through
 * the where-then-what dialog, shown as a terminal and nothing else,
 * grouped by what their directory is, and ended when their tab closes.
 */

test.describe('Terminal tabs', () => {
  // A short repository name: the tab's label is cut from the front to
  // keep the tail readable, and a temp dir's random name is long enough
  // to be cut inside — which is the rule working, not the tab failing.
  test.use({ repo: { name: 'term-repo' } });

  test('a shell in the current repository: opened from the menu, closed with confirmation', async ({
    desktop,
  }) => {
    const { app, page, repoPath } = desktop;

    const dialog = await openNewTerminalDialog(app, page);
    // The open repository is the default answer to "where".
    await expect(
      dialog.getByRole('radio', { name: /Current repository/ })
    ).toHaveAttribute('aria-checked', 'true');
    await confirmNewTerminal(page, 'Shell');

    const tab = terminalTabs(page);
    await expect(tab).toHaveCount(1);
    // Titled by its directory with the tail kept — the tab is narrow and
    // the repository's name is at the end of the path — and the whole
    // path on hover.
    await expect(tab).toContainText(basename(repoPath));
    await expect(tab).toHaveAttribute('title', repoPath);
    await expect(tab).toHaveAttribute('aria-selected', 'true');

    // The host knows it as a shell at that repository's root.
    const listed = await page.evaluate(() => window.n10.listTerminals());
    expect(listed).toEqual([
      expect.objectContaining({
        kind: 'shell',
        cwd: repoPath,
        repo: repoPath,
        running: true,
      }),
    ]);

    // It is a real shell: what is typed into it runs. The prompt has to
    // be up first — a keystroke sent while the shell is still starting
    // is read in cooked mode and lost.
    await expect(
      page.locator('[data-terminal-pane]').getByText(/\S/).first()
    ).toBeVisible({ timeout: 15_000 });
    await focusTerminal(page);
    await page.keyboard.type('echo n10-shell-$((40+2))\n', { delay: 20 });
    await expect(visibleText(page, 'n10-shell-42')).toBeVisible({
      timeout: 15_000,
    });

    // Closing asks first, then ends the session.
    await tab.getByLabel('Close tab').click();
    const confirm = page
      .getByRole('dialog')
      .filter({ hasText: 'Close terminal' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: /End session/ }).click();
    await expect(terminalTabs(page)).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => window.n10.listTerminals()))
      .toEqual([]);
  });

  // The tab is the only handle on the shell, and when the shell is
  // gone there is nothing left to hold: the tab closes by itself, and
  // asks nothing — there is no session left to confirm ending.
  test('a shell tab closes itself when the shell exits', async ({
    desktop,
  }) => {
    const { app, page } = desktop;
    await openNewTerminalDialog(app, page);
    await confirmNewTerminal(page, 'Shell');
    const tab = terminalTabs(page);
    await expect(tab).toHaveCount(1);

    await expect(
      page.locator('[data-terminal-pane]').getByText(/\S/).first()
    ).toBeVisible({ timeout: 15_000 });
    await focusTerminal(page);
    await page.keyboard.type('exit\n', { delay: 20 });

    // At once — on the host's exit event, not the listing's next poll,
    // which is two seconds away.
    await expect(terminalTabs(page)).toHaveCount(0, { timeout: 750 });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await page.evaluate(() => window.n10.listTerminals())).toEqual([]);
  });

  test('a plain folder gets a tab in the repo-less group and switches nothing', async ({
    desktop,
  }) => {
    const { app, page, repoPath } = desktop;
    const folder = mkdtempSync(join(tmpdir(), 'n10-plain-'));
    try {
      // Something of the repository's own on the strip, so the terminal
      // has a group to be apart from.
      await createWorktree(page, 'some-work');

      await openNewTerminalDialog(app, page);
      await armFolderPick(app, folder);
      await newTerminalDialog(page)
        .getByRole('radio', { name: /Other folder/ })
        .click();
      await expect(
        newTerminalDialog(page).getByRole('radio', { name: /Other folder/ })
      ).toContainText(folder);
      await confirmNewTerminal(page, 'Shell');

      const tab = terminalTabs(page);
      await expect(tab).toHaveAttribute('title', folder);
      // A group of its own, yet one continuous row: no gap or divider
      // sets it apart from the repository's tab.
      await expectAdjoining(tabNamed(page, /some-work/), tab);
      // …and no repository prefix, because it belongs to none.
      await expect(tab).not.toContainText(basename(repoPath));

      // Nothing switched, and the host files it under no repository.
      expect(await page.evaluate(() => window.n10.getRepo())).toMatchObject({
        cwd: repoPath,
      });
      const listed = await page.evaluate(() => window.n10.listTerminals());
      expect(listed).toEqual([
        expect.objectContaining({ cwd: folder, repo: null }),
      ]);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });

  test('a picked folder that is a repository root opens that repository', async ({
    desktop,
  }) => {
    const { app, page, repoPath } = desktop;
    const other = createTestRepo({ name: 'picked-repo' });
    try {
      await openNewTerminalDialog(app, page);
      await armFolderPick(app, other);
      await newTerminalDialog(page)
        .getByRole('radio', { name: /Other folder/ })
        .click();
      await confirmNewTerminal(page, 'Shell');

      // The terminal belongs to the picked repository, so the workspace
      // follows it there — the same path as activating a foreign tab.
      await expect
        .poll(() => page.evaluate(() => window.n10.getRepo()), {
          timeout: 30_000,
        })
        .toMatchObject({ cwd: other });
      expect(repoPath).not.toBe(other);

      // …and that repository is now on the list, behind the scenes.
      const recents = await page.evaluate(() => window.n10.listRecentRepos());
      expect(recents.map((r) => r.cwd)).toContain(other);

      // Once there, the tab is at home: no repository prefix.
      const tab = terminalTabs(page);
      await expect(tab).toHaveCount(1);
      await expect(tab).toHaveAttribute('aria-selected', 'true');
      await expect(tab).not.toContainText('picked-repo/');
    } finally {
      cleanupTestRepo(other);
    }
  });

  // The dialog is two steps and two Enters from the keyboard: focus
  // opens on the first choice, the arrows walk a step's choices and
  // wrap, Enter on a "where" choice moves on to "what", and Enter on a
  // "what" choice opens the terminal as that kind.
  test('is driven from the keyboard alone', async ({ desktop }) => {
    const { app, page, repoPath } = desktop;
    const dialog = await openNewTerminalDialog(app, page);
    const choice = (name: RegExp) => dialog.getByRole('radio', { name });

    await expect(choice(/^Current repository/)).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(choice(/^Other repository/)).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(choice(/^Other folder/)).toBeFocused();
    await page.keyboard.press('ArrowDown');
    // …round to the top again, where Enter takes the current repository
    // and moves on to the second step. Moving focus chose nothing.
    await expect(choice(/^Current repository/)).toBeFocused();
    await expect(choice(/^Other folder/)).toHaveAttribute(
      'aria-checked',
      'false'
    );
    await page.keyboard.press('Enter');
    await expect(choice(/^Shell /)).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(choice(/^Agent /)).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(choice(/^Shell /)).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(dialog).toBeHidden();
    const tab = terminalTabs(page);
    await expect(tab).toHaveCount(1);
    await expect(tab).toHaveAttribute('title', repoPath);
    const listed = await page.evaluate(() => window.n10.listTerminals());
    expect(listed).toEqual([
      expect.objectContaining({ kind: 'shell', cwd: repoPath, running: true }),
    ]);
  });

  // The longer keyboard path: Enter on "Other repository" opens the
  // recents list with its first repository focused, Enter there
  // answers "where" and moves on to "what", and Enter opens the
  // terminal in that repository — which the workspace follows.
  test('reaches another repository from the keyboard', async ({ desktop }) => {
    const { app, page, homeDir, repoPath } = desktop;
    const other = createTestRepo({ name: 'kb-repo' });
    try {
      // On the recents list, as a repository opened before would be.
      // The app rewrote the file at startup with the one it opened on,
      // so both are written back.
      writeFileSync(
        join(homeDir, '.n10', 'desktop-recents.json'),
        JSON.stringify([
          { cwd: repoPath, lastOpenedAt: 2 },
          { cwd: other, lastOpenedAt: 1 },
        ])
      );
      const dialog = await openNewTerminalDialog(app, page);
      const choice = (name: RegExp) => dialog.getByRole('radio', { name });

      await page.keyboard.press('ArrowDown');
      await expect(choice(/^Other repository/)).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(choice(/kb-repo/)).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(choice(/^Other repository/)).toHaveAttribute(
        'aria-checked',
        'true'
      );
      await expect(choice(/^Shell /)).toBeFocused();
      await page.keyboard.press('Enter');

      await expect(dialog).toBeHidden();
      const otherRoot = realpathSync(other);
      await expect
        .poll(() => page.evaluate(() => window.n10.getRepo()), {
          timeout: 30_000,
        })
        .toMatchObject({ cwd: otherRoot });
      const listed = await page.evaluate(() => window.n10.listTerminals());
      expect(listed).toEqual([
        expect.objectContaining({
          kind: 'shell',
          cwd: otherRoot,
          repo: otherRoot,
        }),
      ]);
    } finally {
      cleanupTestRepo(other);
    }
  });

  test('is offered from the command palette too', async ({ desktop }) => {
    const { page } = desktop;
    await openPalette(page);
    await page.getByRole('option', { name: /New terminal/ }).click();
    await expect(newTerminalDialog(page)).toBeVisible();
  });
});

test.describe('Agent terminals', () => {
  // An agent that reports what it was seeded with, so "no prompt" is
  // provable rather than assumed.
  test.use({ n10Config: { aiCommand: fakeAgent({ printSeed: true }) } });

  test('runs the configured agent in the directory, with no task', async ({
    desktop,
  }) => {
    const { app, page, repoPath } = desktop;
    await openNewTerminalDialog(app, page);
    await confirmNewTerminal(page, 'Agent');

    await expect(visibleText(page, 'n10-fake-agent-ready')).toBeVisible({
      timeout: 30_000,
    });
    const listed = await page.evaluate(() => window.n10.listTerminals());
    expect(listed).toEqual([
      expect.objectContaining({ kind: 'agent', cwd: repoPath, running: true }),
    ]);

    // tmux emits terminal control sequences around its repaint. Assert
    // the agent's displayed seed line rather than matching raw ANSI bytes.
    await expect(visibleText(page, /^seed:\s*$/)).toBeVisible();
  });
});
