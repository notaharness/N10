import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Shared `toHaveScreenshot` options for the `@visual` suite. Split out
 * of `visual.test.ts` (already at its line budget) so
 * `machines-visual.test.ts` reuses the same zero-tolerance options
 * rather than inventing its own — see `visual.test.ts`'s top comment
 * for why the tolerance is zero and the container is pinned.
 */
export const shot = {
  animations: 'disabled',
  caret: 'hide',
  maxDiffPixels: 0,
} as const;

/** Sonner's toasts, gone. A toast is a timed overlay, not a state: it
 *  dismisses itself a few seconds after the action that raised it, so
 *  whether one is in the frame is decided by how fast the machine got
 *  from the click to the screenshot. A baseline drawn with one in it
 *  fails on a slower machine that reaches the same *state* a moment
 *  later, and a baseline drawn without one fails on a faster machine —
 *  in both directions the shot is a coin toss, not a regression test.
 *  Every machines flow ends in a success toast, so every machines shot
 *  waits them out first. The timeout is longer than the suite default
 *  because it has to outlast the toast's own lifetime, not a render. */
export async function settleToasts(page: Page): Promise<void> {
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0, {
    timeout: 15_000,
  });
}

/**
 * Pin the box a masked element draws, so the mask lands on identical
 * geometry everywhere.
 *
 * A Playwright mask paints over an element's *box*; it does not fix
 * that box's size. Where the masked text is what sizes its own
 * container — an ephemeral port one digit shorter, a countdown reading
 * `10:00` rather than `9:59`, a URL one character past the wrap point —
 * the painted rectangle is a different size every run, and everything
 * laid out after it moves with it. Masking such an element is therefore
 * not enough on its own: the size has to be settled before the mask is
 * applied.
 *
 * `nowrap` + `hidden` makes a block exactly one line tall whatever it
 * contains; `width` additionally fixes an inline element whose width is
 * its text. Asserting visibility here rather than at the call site
 * keeps the existing rule — a mask whose locator stopped matching fails
 * as a locator error instead of as an intermittent pixel diff.
 */
export async function pinMaskedBox(
  locator: Locator,
  width?: string
): Promise<Locator> {
  await expect(locator).toBeVisible();
  await locator.evaluate((node, fixedWidth) => {
    const el = node as HTMLElement;
    el.style.whiteSpace = 'nowrap';
    el.style.overflow = 'hidden';
    if (fixedWidth !== undefined) {
      el.style.display = 'inline-block';
      el.style.width = fixedWidth;
      el.style.verticalAlign = 'bottom';
    }
  }, width);
  return locator;
}
