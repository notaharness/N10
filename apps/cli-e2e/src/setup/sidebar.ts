import type { Page, Locator } from '@playwright/test';
import type { N10Term } from '../fixtures/n10.js';
import { settleFor } from './waits.js';
import { pressUntilSelected } from './selection.js';

// Sidebar icon scheme (apps/cli/src/components/Sidebar.tsx):
//   ◉  selected + running
//   ◎  selected + stopped
//   ●  not-selected + running
//   ○  not-selected + stopped

const SELECTED = '◉◎';
const RUNNING = '◉●';
const ANY = '◉◎●○';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// The title follows its icon directly (only whitespace between them).
// Anything looser bridges into the main pane, which shares the terminal
// row: a PR detail pane repeats the PR title to the right of whichever
// sidebar entry sits on that row, and `[◎].*Add color support` would
// match that entry too.
export function selectedItem(title: string): RegExp {
  return new RegExp(`[${SELECTED}]\\s*${escapeRegExp(title)}`);
}

export function anyItem(title: string): RegExp {
  return new RegExp(`[${ANY}]\\s*${escapeRegExp(title)}`);
}

/** A row with a live agent behind it, selected or not. */
export function runningItem(title: string): RegExp {
  return new RegExp(`[${RUNNING}].*${escapeRegExp(title)}`);
}

// Scope the icon-then-title regex to a single .term-row. Without this,
// Playwright's getByText(/regex/) matches against any element's combined
// text, so the pattern bridges across rows — e.g. `/[◉◎]\s*Add color/`
// would spuriously match when `◉` sits next to a DIFFERENT session that
// happens to appear before "Add color" in the grid.
export function sidebarLocator(page: Page, title: string) {
  return {
    selected: (): Locator =>
      page.locator('.term-row', { hasText: selectedItem(title) }),
    any: (): Locator => page.locator('.term-row', { hasText: anyItem(title) }),
    running: (): Locator =>
      page.locator('.term-row', { hasText: runningItem(title) }),
  };
}

// Section headers (Sidebar.tsx) render as "<title> (<count>)". These are
// the only titles SidebarContext groups by.
const SECTION_LABELS = [
  'Worktrees',
  'Pull Requests',
  'Draft Pull Requests',
  'Needs Your Review',
  'Waiting for Author',
  'Approved by You',
];

const SECTION_HEADER = new RegExp(
  `(?:${SECTION_LABELS.map(escapeRegExp).join('|')})\\s*\\(\\d+\\)`
);

// A parsed "N more" count is only as honest as the string it comes from.
// No indicator row at all means the sidebar isn't scrolled that way — a
// real 0. An indicator row that's present but whose number won't parse
// is a genuine miss, and a miss must never shrink the count: an
// under-count turns into a false "unreachable" diagnosis later (the walk
// gives up before reaching a row that was there all along), whereas an
// over-count only costs a few wasted keypresses before a correct
// failure. So a miss contributes this generous stand-in instead of 0.
const UNPARSED_SCROLL_ROWS = 100;

async function moreCount(page: Page, indicator: RegExp): Promise<number> {
  const row = page.locator('.term-row', { hasText: indicator }).first();
  if ((await row.count()) === 0) return 0;
  const text = await row.textContent();
  const parsed = text?.match(/(\d+)\s+more/);
  if (!parsed) return UNPARSED_SCROLL_ROWS;
  const value = Number(parsed[1]);
  return Number.isNaN(value) ? UNPARSED_SCROLL_ROWS : value;
}

/**
 * Total render-row count in the sidebar — section headers plus items,
 * scroll-proof via the "↑ N more" / "↓ N more" indicators above/below
 * the visible window.
 *
 * This counts render ROWS, not items: a section header counts too, so
 * it is an upper bound on item count, never an exact item count. Rows
 * are whole `.term-row` elements, which span the main pane as well as
 * the sidebar, so main-pane text could in principle inflate a count.
 * That's harmless for both of this function's uses: a bound may
 * over-count, and an identity (successive samples agreeing) only needs
 * to be stable, not exact.
 */
export async function sidebarRowCount(page: Page): Promise<number> {
  const iconRows = await page
    .locator('.term-row', { hasText: new RegExp(`[${ANY}]`) })
    .count();
  const headerRows = await page
    .locator('.term-row', { hasText: SECTION_HEADER })
    .count();
  const above = await moreCount(page, /↑ \d+ more/);
  const below = await moreCount(page, /↓ \d+ more/);
  return iconRows + headerRows + above + below;
}

/**
 * Poll the sidebar's row count until it repeats `samples` times in a
 * row, and return that settled count.
 *
 * This exists because the review-PR lists arrive from GitHub
 * incrementally: a test that only waits for one title to become
 * visible can start walking a list that is still growing underneath
 * it. Rows inserted above the target shift it further down with every
 * poll, so a press-until-visible loop chases a moving target instead
 * of converging inside any bound derived from a single snapshot.
 * Waiting for the count to stop moving first turns "how many rows are
 * there" into a fixed fact the caller can safely bound a walk against.
 */
export async function waitForSidebarSettled(
  page: Page,
  opts: { samples?: number; interval?: number; timeout?: number } = {}
): Promise<number> {
  const { samples = 3, interval = 400, timeout = 20_000 } = opts;
  const start = Date.now();
  const seen: number[] = [];
  let streak = 0;
  let last: number | undefined;

  for (;;) {
    const count = await sidebarRowCount(page);
    seen.push(count);
    streak = count === last ? streak + 1 : 1;
    last = count;
    if (streak >= samples) return count;

    if (Date.now() - start > timeout) {
      const tail = seen.slice(-20);
      throw new Error(
        `Sidebar never settled: row count was still changing after ${timeout}ms.\n` +
          `Samples (oldest first): ${tail.join(', ')}`
      );
    }
    await settleFor(
      page,
      interval,
      'polling for the sidebar row count to stop changing'
    );
  }
}

const HEADROOM_MIN = 10;

/**
 * Presses to allow for a sidebar of `rowCount` render rows.
 *
 * This bound exists to stop an unbounded loop, not to be tight: it
 * pads the settled row count with headroom so a parse miss in
 * `sidebarRowCount` (see `UNPARSED_SCROLL_ROWS`) can't turn into a
 * false "unreachable" failure. Over-counting only costs a few wasted
 * keypresses; under-counting costs a wrong diagnosis.
 */
export function sidebarWalkBound(rowCount: number): number {
  return rowCount + Math.max(HEADROOM_MIN, Math.ceil(rowCount / 2));
}

/**
 * Move the sidebar selection onto the row matching `title`.
 *
 * The walk is bounded by `sidebarWalkBound` of the settled row count
 * (see `waitForSidebarSettled`): the sidebar's selection clamps at both
 * ends and never wraps, so pressing the nav key more times than that
 * bound means the target isn't reachable this way. An `overallTimeout`
 * deadline runs alongside the press bound — the padding in
 * `sidebarWalkBound` is only safe from turning into a long hang if
 * something else also caps the total time spent, since a per-step
 * timeout times a padded bound could otherwise approach or exceed a
 * test's own timeout.
 *
 * The walk itself (bound-vs-deadline tracking, the "selected instead"
 * readout, the one-way-walk hint) is `pressUntilSelected` in
 * `selection.ts` — see that function for why it must not be replaced
 * by a fixed number of presses.
 */
export async function selectSidebarRow(
  term: N10Term,
  title: string,
  opts: {
    key?: string;
    settleTimeout?: number;
    stepTimeout?: number;
    overallTimeout?: number;
  } = {}
): Promise<void> {
  const { key, stepTimeout, settleTimeout, overallTimeout } = opts;
  const { page } = term;
  const rowCount = await waitForSidebarSettled(page, {
    timeout: settleTimeout,
  });
  const bound = sidebarWalkBound(rowCount);
  const row = sidebarLocator(page, title);

  await pressUntilSelected(term, row.selected(), bound, {
    what: title,
    subject: 'Sidebar selection',
    key,
    stepTimeout,
    overallTimeout,
    scope: ` across ${rowCount} settled sidebar rows`,
  });
}
