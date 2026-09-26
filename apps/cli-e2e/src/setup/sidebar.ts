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
 * Is the selection sitting on the first row the sidebar renders?
 *
 * The first `.term-row` carrying any item icon is the top of the list
 * once the scroll window has been pulled all the way up, so the top is
 * reached exactly when that row is also a selected row.
 */
async function selectionAtTop(page: Page): Promise<boolean> {
  const first = page
    .locator('.term-row', { hasText: new RegExp(`[${ANY}]`) })
    .first();
  if ((await first.count()) === 0) return false;
  const text = (await first.textContent()) ?? '';
  return new RegExp(`[${SELECTED}]`).test(text);
}

/**
 * Pull the selection back to the first row before walking down.
 *
 * The selection does not stay where the app started it. It begins at
 * index 0, but `reconcileSelection` (SidebarContext.tsx) ADOPTS the row
 * the cursor resolved onto as the new anchor key, and from then on the
 * cursor follows that row rather than the index. The review list is
 * served cache-first and refreshed in the background
 * (`pull-request-cache.ts`), so the refresh can insert rows ABOVE the
 * adopted row and carry the cursor down with them. A target that sat
 * above the cursor is then unreachable: the walk travels one way and
 * the selection clamps.
 *
 * Settling the list first does not help — it stops the list moving, but
 * it cannot rewind a cursor that already drifted past the target.
 *
 * This is not "press N times and hope". Pressing up more times than
 * there are rows saturates a clamp at a known boundary, so the
 * postcondition is "the first row is selected" for ANY overshoot. The
 * loop checks that postcondition before each press and stops the moment
 * it holds, so an already-top selection costs one DOM read and no
 * presses. Returns whether the top was actually reached, so a later
 * failure can say the rewind fell short rather than blaming the target.
 */
async function rewindToTop(
  term: N10Term,
  rewindKey: string,
  bound: number
): Promise<boolean> {
  const { page } = term;
  for (let i = 0; i < bound; i++) {
    if (await selectionAtTop(page)) return true;
    await term.press(rewindKey);
  }
  return selectionAtTop(page);
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
 *
 * `rewindToTop` runs first so the walk starts from the top of the list
 * rather than wherever the cursor drifted to while the list loaded —
 * see that function for the drift. `key` and `rewindKey` are a pair: a
 * caller that walks with something other than 'j' must give the
 * matching opposite direction.
 */
export async function selectSidebarRow(
  term: N10Term,
  title: string,
  opts: {
    key?: string;
    rewindKey?: string;
    settleTimeout?: number;
    stepTimeout?: number;
    overallTimeout?: number;
  } = {}
): Promise<void> {
  const {
    key,
    rewindKey = 'k',
    stepTimeout,
    settleTimeout,
    overallTimeout,
  } = opts;
  const { page } = term;
  const rowCount = await waitForSidebarSettled(page, {
    timeout: settleTimeout,
  });
  const bound = sidebarWalkBound(rowCount);
  const row = sidebarLocator(page, title);
  const rewound = await rewindToTop(term, rewindKey, bound);
  const scope = rewound
    ? ` across ${rowCount} settled sidebar rows`
    : ` across ${rowCount} settled sidebar rows, having failed to rewind` +
      ` the selection to the first row first`;

  await pressUntilSelected(term, row.selected(), bound, {
    what: title,
    subject: 'Sidebar selection',
    key,
    stepTimeout,
    overallTimeout,
    scope,
  });
}
