import type { Locator, Page } from '@playwright/test';
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

/** The strip's tab labels, left to right. */
async function tabNames(page: Page): Promise<string[]> {
  return (await tabs(page).allInnerTexts()).map((t) => t.split('\n')[0].trim());
}

/** Press `from` and carry it, in pointer steps, over `to`'s centre —
 *  still held, so the test can look at the strip mid-drag. */
async function carryOver(page: Page, from: Locator, to: Locator) {
  const [a, b] = await Promise.all([from.boundingBox(), to.boundingBox()]);
  if (!a || !b) throw new Error('tab is not laid out');
  const y = a.y + a.height / 2;
  await page.mouse.move(a.x + a.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, y, { steps: 10 });
}

const LIFT = 'Control+Shift+Space';

/** Nothing on the strip has been lifted. A lift starts a sort that
 *  puts a transform on every tab within the frame, so after two frames
 *  an untransformed row means no drag began. */
async function expectNothingLifted(page: Page) {
  await page.evaluate(
    () =>
      new Promise((done) =>
        requestAnimationFrame(() => requestAnimationFrame(done))
      )
  );
  for (const t of await tabs(page).all()) {
    expect(await motion(t)).toMatchObject({ transform: '' });
  }
  await expect(page.getByText(/^Picked up /)).toHaveCount(0);
}

/** Focus `name`'s tab, lift it with the chord and step it right, until
 *  `neighbour` has slid aside. The sensor starts listening for arrows
 *  a task after the lift, so an early press can go unheard. */
async function liftRightOver(page: Page, name: RegExp, neighbour: RegExp) {
  await tab(page, name).focus();
  await page.keyboard.press(LIFT);
  await expect(async () => {
    await page.keyboard.press('ArrowRight');
    expect(await motion(tab(page, neighbour))).toMatchObject({
      transform: expect.stringMatching(/^translate3d\(-\d/),
    });
  }).toPass();
}

/** The inline motion the sortable strip puts on a tab. */
function motion(tab: Locator) {
  return tab.evaluate((el: HTMLElement) => ({
    transform: el.style.transform,
    transition: el.style.transition,
  }));
}

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
});

test.describe('Reordering tabs', () => {
  test.beforeEach(async ({ desktop }) => {
    await createWorktree(desktop.page, 'alpha');
    await createWorktree(desktop.page, 'beta');
    await expect.poll(() => tabNames(desktop.page)).toEqual(['alpha', 'beta']);
  });

  test('the others slide aside while a tab is dragged, and it drops into the gap', async ({
    desktop,
  }) => {
    const { page } = desktop;
    const beta = tab(page, /beta/);
    await carryOver(page, tab(page, /alpha/), beta);

    // Mid-drag, beta has slid left into alpha's slot — animated — while
    // the order itself is untouched until the drop.
    await expect
      .poll(() => motion(beta))
      .toEqual({
        transform: expect.stringMatching(/^translate3d\(-\d/),
        transition: expect.stringContaining('transform'),
      });
    expect(await tabNames(page)).toEqual(['alpha', 'beta']);

    await page.mouse.up();
    await expect.poll(() => tabNames(page)).toEqual(['beta', 'alpha']);
    await expect.poll(() => motion(beta)).toMatchObject({ transform: '' });
  });

  test('with reduced motion the tabs move aside without sliding', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const beta = tab(page, /beta/);
    await carryOver(page, tab(page, /alpha/), beta);

    await expect
      .poll(() => motion(beta))
      .toEqual({
        transform: expect.stringMatching(/^translate3d\(-\d/),
        transition: '',
      });
    await page.mouse.up();
    await expect.poll(() => tabNames(page)).toEqual(['beta', 'alpha']);
  });

  test('a tab can be reordered from the keyboard', async ({ desktop }) => {
    const { page } = desktop;
    await liftRightOver(page, /alpha/, /beta/);
    await page.keyboard.press('Space');
    await expect.poll(() => tabNames(page)).toEqual(['beta', 'alpha']);
  });

  test('Escape puts a keyboard-lifted tab back', async ({ desktop }) => {
    const { page } = desktop;
    await liftRightOver(page, /alpha/, /beta/);
    await page.keyboard.press('Escape');
    await expect
      .poll(() => motion(tab(page, /beta/)))
      .toMatchObject({ transform: '' });
    expect(await tabNames(page)).toEqual(['alpha', 'beta']);
  });

  test('Enter and Space activate a tab; the arrows move focus along the row', async ({
    desktop,
  }) => {
    const { page } = desktop;
    const [alpha, beta] = [tab(page, /alpha/), tab(page, /beta/)];
    // One Tab stop for the row: the active tab.
    await expect(beta).toHaveAttribute('tabindex', '0');
    await expect(alpha).toHaveAttribute('tabindex', '-1');

    // A click focuses the tab, so a stray Space afterwards must not
    // lift it: it activates, as on any tab.
    await alpha.click();
    await page.keyboard.press('Space');
    await page.keyboard.press('ArrowRight');
    await expect(beta).toBeFocused();
    await expect(alpha).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Enter');
    await expect(beta).toHaveAttribute('aria-selected', 'true');
    // The arrows wrap.
    await page.keyboard.press('ArrowRight');
    await expect(alpha).toBeFocused();
    await page.keyboard.press('Space');
    await expect(alpha).toHaveAttribute('aria-selected', 'true');

    await expectNothingLifted(page);
    expect(await tabNames(page)).toEqual(['alpha', 'beta']);
  });

  test('keys on the close button never lift the tab', async ({ desktop }) => {
    const { page } = desktop;
    const close = tab(page, /beta/).getByLabel('Close tab');
    await close.focus();
    await page.keyboard.press(LIFT);
    await expectNothingLifted(page);
    await page.keyboard.press('Enter');
    await expect(tab(page, /beta/)).toHaveCount(0);
    await expectNothingLifted(page);
  });
});
