import { expect, type Locator, type Page } from '@playwright/test';
import { tab, tabs } from './app.js';

/**
 * Driving the sortable tab row (dnd-kit): pointer drags in steps, the
 * keyboard lift chord, and the inline motion dnd-kit puts on each tab.
 */

/** The strip's tab labels, left to right. */
export async function tabNames(page: Page): Promise<string[]> {
  return (await tabs(page).allInnerTexts()).map((t) => t.split('\n')[0].trim());
}

/** Press `from` and carry it, in pointer steps, over `to`'s centre —
 *  still held, so the test can look at the strip mid-drag. */
export async function carryOver(page: Page, from: Locator, to: Locator) {
  const [a, b] = await Promise.all([from.boundingBox(), to.boundingBox()]);
  if (!a || !b) throw new Error('tab is not laid out');
  const y = a.y + a.height / 2;
  await page.mouse.move(a.x + a.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, y, { steps: 10 });
}

export const LIFT = 'Control+Shift+Space';

/** Nothing on the strip has been lifted. A lift starts a sort that
 *  puts a transform on every tab within the frame, so after two frames
 *  an untransformed row means no drag began. */
export async function expectNothingLifted(page: Page) {
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
export async function liftRightOver(
  page: Page,
  name: RegExp,
  neighbour: RegExp
) {
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
export function motion(tab: Locator) {
  return tab.evaluate((el: HTMLElement) => ({
    transform: el.style.transform,
    transition: el.style.transition,
  }));
}
