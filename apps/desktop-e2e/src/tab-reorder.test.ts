import { test, expect } from './fixtures/desktop.js';
import { createWorktree, tab } from './setup/app.js';
import {
  carryOver,
  expectNothingLifted,
  LIFT,
  liftRightOver,
  motion,
  tabNames,
} from './setup/tab-row.js';

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

  test('the tab keys: Enter and Space activate, the arrows, Home and End move focus', async ({
    desktop,
  }) => {
    const { page } = desktop;
    const [alpha, beta] = [tab(page, /alpha/), tab(page, /beta/)];
    // One Tab stop for the row: the active tab. The close buttons are
    // out of the Tab order.
    await expect(beta).toHaveAttribute('tabindex', '0');
    await expect(alpha).toHaveAttribute('tabindex', '-1');
    await expect(beta.getByLabel('Close tab')).toHaveAttribute(
      'tabindex',
      '-1'
    );

    await alpha.focus();
    await page.keyboard.press('ArrowRight');
    await expect(beta).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(beta).toHaveAttribute('aria-selected', 'true');
    // The arrows wrap, both ways.
    await page.keyboard.press('ArrowRight');
    await expect(alpha).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(beta).toBeFocused();
    await page.keyboard.press('Home');
    await expect(alpha).toBeFocused();
    await page.keyboard.press('Space');
    await expect(alpha).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('End');
    await expect(beta).toBeFocused();

    await expectNothingLifted(page);
    expect(await tabNames(page)).toEqual(['alpha', 'beta']);
  });

  test('a click on a tab takes no focus, so a stray Space lifts nothing', async ({
    desktop,
  }) => {
    const { page } = desktop;
    const alpha = tab(page, /alpha/);
    await alpha.click();
    await expect(alpha).toHaveAttribute('aria-selected', 'true');
    await expect(alpha).not.toBeFocused();
    await page.keyboard.press('Space');
    await expectNothingLifted(page);
  });

  test('Delete closes the focused tab', async ({ desktop }) => {
    const { page } = desktop;
    await tab(page, /beta/).focus();
    await page.keyboard.press('Delete');
    await expect(tab(page, /beta/)).toHaveCount(0);
    expect(await tabNames(page)).toEqual(['alpha']);
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
