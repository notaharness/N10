import type { Page } from '@playwright/test';
import { sessionBranch } from './setup/session-keys.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, fakeAgent } from './fixtures/desktop.js';
import {
  agentSpinner,
  createWorktree,
  focusTerminal,
  launchAgentFromRail,
  openPalette,
  sidebarRow,
  tabs,
} from './setup/app.js';
import { armContextMenuChoice } from './setup/menu.js';

/**
 * What the app does when something goes wrong.
 *
 * Every one of these is a real path a user hits — an agent that dies on
 * startup, an editor that was never configured, a branch name git
 * refuses — and the failure has to *arrive somewhere*. A rejected
 * promise nobody surfaces looks identical to a button that does
 * nothing.
 *
 * These are all deterministic and offline: nothing here depends on a
 * provider being reachable, so a failing network can't make them lie.
 */

/**
 * Wait for tmux's retained dead-pane notice.
 *
 * The agent exits in milliseconds, but the notice is several hops away:
 * the session is created in a utility process, the backend polls the
 * pane every 500ms, and only then is the retained frame replayed into
 * the renderer. On a loaded two-core runner that chain routinely takes
 * longer than the suite's default expect timeout, so every test that
 * waits for it waits on the same budget.
 */
function expectPaneDead(page: Page): Promise<void> {
  return expect(page.getByText(/Pane is dead/i).first()).toBeVisible({
    timeout: 30_000,
  });
}

test.describe('An agent that exits immediately', () => {
  test.use({ n10Config: { aiCommand: fakeAgent({ exitAfterMs: 300 }) } });

  test('says so in the terminal and stops reporting as running', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await createWorktree(page, 'short-lived');
    await launchAgentFromRail(page);

    // tmux retains the final frame and its dead-pane notice, even when
    // the process exits before the renderer subscribes.
    await expectPaneDead(page);

    await expect
      .poll(
        async () => {
          const sessions = await page.evaluate(() => window.n10.listSessions());
          return (
            sessions.find((s) => sessionBranch(s.name) === 'short-lived')
              ?.running ?? true
          );
        },
        { timeout: 20_000 }
      )
      .toBe(false);
    await expect(
      page.getByRole('button', { name: 'Relaunch agent', exact: true })
    ).toBeVisible();
  });

  test('typing into an exited agent reports the failed delivery without a renderer exception', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await createWorktree(page, 'short-lived');
    await launchAgentFromRail(page);
    await expectPaneDead(page);
    await expect(
      page.getByRole('button', { name: 'Relaunch agent', exact: true })
    ).toBeVisible();

    await focusTerminal(page);
    await page.keyboard.type('hello');
    expect(desktop.pageErrors).toEqual([]);
    await expect(page.getByText(/Session .* is not running/)).toBeVisible();
    await expect(tabs(page)).toHaveCount(1);
  });

  test('closing its tab afterwards needs no confirmation', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await createWorktree(page, 'short-lived');
    await launchAgentFromRail(page);
    await expectPaneDead(page);
    await expect(
      page.getByRole('button', { name: 'Relaunch agent', exact: true })
    ).toBeVisible();
    // Wait for the application to agree that the retained agent exited.
    // The activity map used by the close path is polled once a second.
    await expect(agentSpinner(page)).toHaveCount(0, { timeout: 15_000 });

    await page
      .getByRole('tab', { name: /short-lived/ })
      .getByLabel('Close tab')
      .click();
    // Nothing is still working, so nothing to warn about.
    await expect(page.getByText('Agent is still working')).toHaveCount(0);
    await expect(tabs(page)).toHaveCount(0);
  });
});

test.describe('Failures the user can see', () => {
  test('refuses a branch name git will not accept, and says why', async ({
    desktop,
  }) => {
    const { page, repoPath } = desktop;
    const bad = 'bad..name';

    const input = await openPalette(page);
    await input.fill(bad);
    const createRow = page.getByRole('option', { name: /Create branch/ });
    await createRow.waitFor({ state: 'visible' });
    await createRow.click();

    // The failure has to arrive somewhere: a toast, and the optimistic
    // tab taken back down. Reporting success and leaving a tab on
    // "Preparing…" forever is what this guards against.
    await expect(
      page.getByText(/Failed to create a worktree/i).first()
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(`Preparing ${bad}…`)).toHaveCount(0);
    await expect(tabs(page)).toHaveCount(0);
    expect(existsSync(join(repoPath, '.claude', 'worktrees', bad))).toBe(false);
  });

  test('reports that no editor is configured rather than failing silently', async ({
    desktop,
  }) => {
    const { page, app } = desktop;
    await createWorktree(page, 'no-editor');

    await armContextMenuChoice(app, 'Open in editor');
    await sidebarRow(page, /no-editor/).click({ button: 'right' });

    // config.editor is unset and the fixture passes no VISUAL/EDITOR.
    await expect(page.getByText(/No editor configured/i)).toBeVisible();
  });

  test('shows that no provider is configured instead of an empty review UI', async ({
    desktop,
  }) => {
    const { page } = desktop;
    // A repo with no remote is first-class; the status bar says so
    // rather than the reviews simply never appearing.
    await expect(
      page.getByRole('button', { name: /No provider/ })
    ).toBeVisible();
  });
});

test.describe('An agent command that does not exist', () => {
  test.use({ n10Config: { aiCommand: '/nonexistent/definitely-not-here' } });

  test('surfaces the launch failure rather than leaving an empty pane', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await createWorktree(page, 'broken-agent');
    await launchAgentFromRail(page);

    // The shell's complaint reaches the terminal, and the session ends.
    // Asserting on attachment rather than visibility: the text lands in
    // the terminal's scrollback, which need not be in view.
    await expect(
      page.getByText(/not found|no such file|ENOENT/i).first()
    ).toBeAttached({ timeout: 30_000 });
    await expect
      .poll(
        async () => {
          const sessions = await page.evaluate(() => window.n10.listSessions());
          return (
            sessions.find((s) => sessionBranch(s.name) === 'broken-agent')
              ?.running ?? false
          );
        },
        { timeout: 20_000 }
      )
      .toBe(false);
  });
});
