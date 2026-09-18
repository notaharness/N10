import type { Locator, Page } from '@playwright/test';

/**
 * Locators for the desktop shell, in one place.
 *
 * Several labels appear twice on purpose in the UI (the sidebar's
 * "New worktree" toolbar button and the empty state's button, for
 * one), so tests that build their own locators trip over strict mode.
 * These helpers scope each one to the region it belongs to.
 */

export function sidebar(page: Page): Locator {
  return page.locator('aside');
}

/** The sidebar toolbar's + button. */
export function newWorktreeButton(page: Page): Locator {
  return sidebar(page).getByLabel('New worktree');
}

/** The button inside the "no worktrees yet" empty state. */
export function emptyStateNewWorktree(page: Page): Locator {
  return sidebar(page).getByRole('button', { name: 'New worktree' }).last();
}

export function sidebarRow(page: Page, name: string | RegExp): Locator {
  return sidebar(page).getByRole('button', { name });
}

/** `exact` matters for proving a tab's label carries *no* prefix (D8):
 *  a substring match for the branch alone would still pass with
 *  `workbox · branch`, so a guard against a regression there needs the
 *  full accessible name, not a fragment of it. */
export function tab(page: Page, name: string | RegExp, exact = false): Locator {
  return page.getByRole('tab', { name, exact });
}

export function tabs(page: Page): Locator {
  return page.getByRole('tab');
}

/**
 * The spinner the tab strip and sidebar show while an agent is
 * actively producing output.
 *
 * This is the same signal `useCloseTabs` reads to decide whether to
 * confirm, so waiting on it is what makes those tests deterministic:
 * host-side activity is polled once a second, and a session counts as
 * active for ACTIVITY_IDLE_MS (2s) after its last byte — including the
 * banner an "idle" agent prints on startup.
 */
export function agentSpinner(page: Page): Locator {
  return page.locator('.agent-spinner');
}

/**
 * Text that is actually on screen.
 *
 * Panes for tabs with a live session stay mounted and are hidden with
 * CSS rather than unmounted, so a bare `getByText` happily matches the
 * *other* terminal's output. Anything asserting what the user can see
 * has to filter to the visible one.
 */
export function visibleText(page: Page, text: string | RegExp): Locator {
  return page.getByText(text).filter({ visible: true }).first();
}

/**
 * Focus the on-screen terminal so keystrokes reach the agent.
 *
 * wterm keeps a hidden textarea and focuses it itself; clicking the
 * rendered output instead moves focus off it, and everything typed
 * afterwards goes nowhere.
 */
export async function focusTerminal(page: Page): Promise<void> {
  const input = page.locator('textarea').filter({ visible: true }).first();
  await input.waitFor({ state: 'visible' });
  await input.focus();
}

/** The command palette's input, once open. */
export function paletteInput(page: Page): Locator {
  return page.getByPlaceholder('Branch name, pull request, or command…');
}

export async function openPalette(page: Page): Promise<Locator> {
  await page.keyboard.press('Control+k');
  const input = paletteInput(page);
  await input.waitFor({ state: 'visible' });
  return input;
}

/**
 * Open a worktree for `branch` through the command palette, and wait
 * for the sidebar to show it.
 *
 * The palette offers two different rows depending on the branch: a
 * "Create branch…" row for a name git doesn't know yet, and a plain
 * checkout row under "Check out branch" for one that already exists.
 * Both end in the same worktree, so this takes whichever is on offer.
 */
export async function createWorktree(
  page: Page,
  branch: string
): Promise<void> {
  const input = await openPalette(page);
  await input.fill(branch);

  const createRow = page.getByRole('option', {
    name: new RegExp(`Create branch\\s*${branch}\\s*and open a worktree`),
  });
  const checkoutRow = page
    .getByRole('option', { name: new RegExp(`^${branch}$`) })
    .first();
  await createRow
    .or(checkoutRow)
    .first()
    .waitFor({ state: 'visible', timeout: 15_000 });
  await ((await createRow.count()) > 0 ? createRow : checkoutRow).click();

  await paletteInput(page).waitFor({ state: 'hidden' });

  // A checkout lands in the new worktree's session menu, and a modal
  // dialog hides the rest of the app from role queries (aria-hidden),
  // sidebar included — so the menu has to go before the row can be
  // waited on. Dismissing it here leaves the caller a quiet tab;
  // `launchAgentFromRail` reopens it when the test wants an agent. A
  // branch that already had a worktree is a jump, not a checkout, and
  // opens no menu.
  const row = sidebarRow(page, new RegExp(branch));
  const menu = sessionMenu(page);
  await menu.or(row).first().waitFor({ state: 'visible', timeout: 30_000 });
  if (await menu.isVisible()) await dismissSessionMenu(page);
  await row.waitFor({ state: 'visible', timeout: 30_000 });
}

/** The session menu ("What would you like to do?"), once open. */
export function sessionMenu(page: Page): Locator {
  return page.locator('[data-launch-dialog]');
}

/** The menu's agent picker. */
export function agentPicker(page: Page): Locator {
  return sessionMenu(page).getByRole('combobox', { name: 'Agent' });
}

/** Take the open menu's session row with the agent it shows. */
export async function startSessionFromMenu(page: Page): Promise<void> {
  const menu = sessionMenu(page);
  await menu.waitFor({ state: 'visible', timeout: 15_000 });
  await menu
    .getByRole('button', {
      name: /^(Start new session|Continue with .+|Open .+)$/,
    })
    .click();
  await menu.waitFor({ state: 'hidden' });
}

/** Close the open menu without launching anything. */
export async function dismissSessionMenu(page: Page): Promise<void> {
  const menu = sessionMenu(page);
  await menu.waitFor({ state: 'visible', timeout: 15_000 });
  await page.keyboard.press('Escape');
  await menu.waitFor({ state: 'hidden' });
}

/**
 * Launch the tab's agent the way a user does: the rail's Launch button
 * opens the session menu, and its session row starts the default
 * agent. Returns once the menu is gone — follow with an assertion on
 * the agent's output.
 */
export async function launchAgentFromRail(page: Page): Promise<void> {
  await page
    .getByRole('button', { name: /(Re)?launch agent/i })
    .filter({ visible: true })
    .first()
    .click();
  await startSessionFromMenu(page);
}

/**
 * The review rail's file tree.
 *
 * Scoped by its own attribute rather than by text: every path it lists
 * also appears in the diff pane's file headers, so an unscoped
 * `getByText('guide.md')` cannot tell a tree row that is hidden from a
 * diff header that is not.
 */
export function fileTree(page: Page): Locator {
  return page.locator('[data-file-tree]');
}

/**
 * A folder row in the file tree. Folder rows are the only buttons whose
 * whole accessible name is the directory's name — a file row carries its
 * churn counts too — so an exact match is enough, and strict mode reports
 * it if that ever stops being true. `aria-expanded` says whether it is
 * open.
 */
export function fileTreeFolder(page: Page, name: string): Locator {
  return fileTree(page).getByRole('button', { name, exact: true });
}
