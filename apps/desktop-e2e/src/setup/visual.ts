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
