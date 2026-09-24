import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/desktop.js';
import {
  createWorktree,
  dismissSessionMenu,
  sessionMenu,
  sidebarRow,
  tab,
  tabs,
} from './setup/app.js';
import { armContextMenuChoice, clickAppMenuItem } from './setup/menu.js';

/** Close every open tab with its own X button. */
async function closeAllTabs(page: Page): Promise<void> {
  const strip = tabs(page);
  for (let remaining = await strip.count(); remaining > 0; remaining--) {
    await strip.first().getByLabel('Close tab').click();
    await expect(strip).toHaveCount(remaining - 1);
  }
}

test.describe('Editor tabs', () => {
  test('a single click previews, and the next preview replaces it', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await createWorktree(page, 'alpha');
    await createWorktree(page, 'beta');
    await closeAllTabs(page);

    await sidebarRow(page, /alpha/).click();
    await expect(tabs(page)).toHaveCount(1);
    await expect(tab(page, /alpha/)).toBeVisible();

    // A preview tab is reused rather than stacked.
    await sidebarRow(page, /beta/).click();
    await expect(tabs(page)).toHaveCount(1);
    await expect(tab(page, /beta/)).toBeVisible();
    await expect(tab(page, /alpha/)).toHaveCount(0);
  });

  test('a double click pins the tab so the next preview opens beside it', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await createWorktree(page, 'alpha');
    await createWorktree(page, 'beta');
    await closeAllTabs(page);

    await sidebarRow(page, /alpha/).dblclick();
    // Activating an idle row also opens its session menu; while that
    // modal is up the rest of the app is hidden from role queries.
    await dismissSessionMenu(page);
    await expect(tab(page, /alpha/)).toBeVisible();

    await sidebarRow(page, /beta/).click();
    await expect(tabs(page)).toHaveCount(2);
    await expect(tab(page, /alpha/)).toBeVisible();
    await expect(tab(page, /beta/)).toBeVisible();
  });

  test('Enter on a row whose tab is open behind another opens its session menu', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await createWorktree(page, 'alpha');
    await createWorktree(page, 'beta');
    await expect(tab(page, /beta/)).toHaveAttribute('aria-selected', 'true');

    // alpha's pane is mounted but not in front: the request must reach
    // it as it comes forward, not be dropped for arriving while it is
    // still behind.
    await sidebarRow(page, /alpha/).focus();
    await page.keyboard.press('Enter');
    await expect(sessionMenu(page)).toBeVisible();
    await dismissSessionMenu(page);
    await expect(tab(page, /alpha/)).toHaveAttribute('aria-selected', 'true');
  });

  test('Close Others from the tab context menu keeps only that tab', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await createWorktree(page, 'alpha');
    await createWorktree(page, 'beta');
    await expect(tabs(page)).toHaveCount(2);

    await armContextMenuChoice(desktop.app, 'Close Others');
    await tab(page, /alpha/).click({ button: 'right' });

    await expect(tabs(page)).toHaveCount(1);
    await expect(tab(page, /alpha/)).toBeVisible();
  });

  test('Close All from the tab context menu empties the strip', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await createWorktree(page, 'alpha');
    await createWorktree(page, 'beta');
    await expect(tabs(page)).toHaveCount(2);

    await armContextMenuChoice(desktop.app, 'Close All');
    await tab(page, /beta/).click({ button: 'right' });

    await expect(tabs(page)).toHaveCount(0);

    // …and stays empty through a sidebar refresh. The effect that opens
    // a tab per running agent reacts to the sidebar model, so a refetch
    // is when a closed tab would come back if that effect ever stopped
    // respecting manual closes.
    await page.locator('aside').getByLabel('Refresh').click();
    await expect(tabs(page)).toHaveCount(0);
  });

  test('a middle click closes a tab', async ({ desktop }) => {
    const { page } = desktop;
    await createWorktree(page, 'alpha');
    await expect(tab(page, /alpha/)).toBeVisible();

    await tab(page, /alpha/).click({ button: 'middle' });
    await expect(tab(page, /alpha/)).toHaveCount(0);
  });

  test('the native Settings menu item opens settings as its own tab', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await createWorktree(page, 'alpha');

    // Ctrl+, is a native menu accelerator, not a renderer keybinding,
    // so this drives the real menu item — exercising menu.ts →
    // sendMenuCommand → the renderer's onMenuCommand routing.
    await clickAppMenuItem(desktop.app, 'Settings…');
    await expect(tab(page, /Settings/)).toBeVisible();

    await tab(page, /alpha/).click();
    await expect(tab(page, /Settings/)).toBeVisible();
    await expect(tabs(page)).toHaveCount(2);

    // Re-opening settings focuses the existing tab instead of stacking.
    await clickAppMenuItem(desktop.app, 'Settings…');
    await expect(tabs(page)).toHaveCount(2);
  });

  test('a tab can be dragged to a new position', async ({ desktop }) => {
    const { page } = desktop;
    await createWorktree(page, 'alpha');
    await createWorktree(page, 'beta');
    await expect(tabs(page)).toHaveCount(2);

    const names = async () =>
      (await tabs(page).allInnerTexts()).map((t) => t.split('\n')[0].trim());
    expect(await names()).toEqual(['alpha', 'beta']);

    // The strip carries its own dataTransfer payload and drop-side
    // maths; the reducer's unit tests say nothing about whether the
    // DOM half is wired up.
    await tab(page, /alpha/).dragTo(tab(page, /beta/));
    await expect.poll(names, { timeout: 10_000 }).toEqual(['beta', 'alpha']);
  });
});
