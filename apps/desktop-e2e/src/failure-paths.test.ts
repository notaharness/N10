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
  visibleText,
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
 * Wait until the host says this branch's agent has finished.
 *
 * Not the rail's "Relaunch agent" button, and deliberately so. That
 * button reads `hasSession && !running`, and `running` reaches the
 * renderer through a query polled every two seconds — so it is equally
 * true in the window between the launch creating the session and the
 * first poll that catches it alive. A wait on the button alone lands
 * in that window on a loaded machine and hands the test back an agent
 * that is still starting: the assertions that follow then describe a
 * live session and fail for the wrong reason.
 *
 * `listSessions()` is answered by the host from its own registry with
 * no cache in front of it, and a name only appears there once the
 * session has been created — so a session that is present and not
 * running has genuinely exited. The button is then waited on second,
 * because that is the exit as the user meets it.
 *
 * It is deliberately not tmux's retained "Pane is dead" notice either.
 * That notice is written only once tmux has reaped the pane's process,
 * while `pane_dead` flips earlier and independently, when the pane's
 * file descriptor closes. Short of CPU the two come apart for good:
 * the pane reads dead with the process left unreaped, so
 * `pane_dead_status`, `pane_dead_signal` and `pane_dead_time` stay
 * empty and the notice is never written into the pane at all. No
 * capture and no repaint can produce text tmux did not write.
 */
async function expectAgentExited(page: Page, branch: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const sessions = await page.evaluate(() => window.n10.listSessions());
        return (
          sessions.find((s) => sessionBranch(s.name) === branch)?.running ??
          true
        );
      },
      { timeout: 30_000 }
    )
    .toBe(false);
  await expect(
    page.getByRole('button', { name: 'Relaunch agent', exact: true })
  ).toBeVisible({ timeout: 30_000 });
}

test.describe('An agent that exits immediately', () => {
  test.use({ n10Config: { aiCommand: fakeAgent({ exitAfterMs: 300 }) } });

  test('keeps its last output on screen and stops reporting as running', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await createWorktree(page, 'short-lived');
    await launchAgentFromRail(page);
    await expectAgentExited(page, 'short-lived');

    // The exit swaps the pane for tmux's retained frame, so what the
    // agent printed has to survive that swap. A capture that came back
    // empty would clear the terminal and leave the user with nothing.
    await expect(visibleText(page, 'n10-fake-agent-ready')).toBeVisible();
  });

  test('typing into an exited agent reports the failed delivery without a renderer exception', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await createWorktree(page, 'short-lived');
    await launchAgentFromRail(page);
    await expectAgentExited(page, 'short-lived');

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
    await expectAgentExited(page, 'short-lived');
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

    // The shell's complaint is on screen, and the session ends. On
    // screen, not merely in the DOM: an agent whose command is missing
    // is gone in milliseconds, so the pane has to follow the session
    // appearing rather than the poll that reports it running — miss
    // that and the terminal is never put in front, the complaint is
    // written into a pane nobody is shown, and the launch fails in
    // silence with the diff still up.
    await expect(
      visibleText(page, /not found|no such file|ENOENT/i)
    ).toBeVisible({ timeout: 30_000 });
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
