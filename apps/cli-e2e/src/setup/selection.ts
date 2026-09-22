import type { Locator } from '@playwright/test';
import type { N10Term } from '../fixtures/n10.js';

// Sidebar's selected-icon rows (Sidebar.tsx). Kept here as the default
// `currentlySelected` locator so a caller walking the sidebar itself
// doesn't have to pass one — see `sidebar.ts`'s SELECTED for the same
// icon set applied to a specific row's title.
const SELECTED = '◉◎';

/** Read a selected-row locator's text for an error message. */
export async function describeSelectedRow(locator: Locator): Promise<string> {
  try {
    const row = locator.first();
    if ((await row.count()) === 0) return '(no row is selected)';
    const text = (await row.textContent()) ?? '';
    const collapsed = text.replace(/\s+/g, ' ').trim();
    return `"${collapsed.slice(0, 200)}"`;
  } catch {
    return '(could not read the selected row)';
  }
}

/**
 * Press a key until `selectedLocator` becomes visible, bounded by
 * `maxPresses` and by a wall-clock `overallTimeout` running alongside it.
 *
 * `page.keyboard.press` returns before wterm's DOM updates, so a tight
 * loop that only checks `.count()` overshoots — a per-press `waitFor`
 * lets each render settle before deciding whether to press again.
 *
 * This deliberately does NOT retry past either limit or extend a
 * timeout, and must not be replaced by a fixed number of presses: a
 * fixed count can silently land on — and pass a test against — the
 * wrong row when the list is shorter or longer than expected. Sidebar
 * walks and diff-file-list walks share this exact shape; only the
 * locator being watched and the "selected instead" readout differ,
 * which callers supply through `opts` rather than forking the loop.
 */
export async function pressUntilSelected(
  term: N10Term,
  selectedLocator: Locator,
  maxPresses: number,
  opts: {
    what: string;
    subject?: string;
    key?: string;
    stepTimeout?: number;
    overallTimeout?: number;
    currentlySelected?: Locator;
    scope?: string;
  }
): Promise<void> {
  const {
    what,
    subject = 'Selection',
    key = 'j',
    stepTimeout = 1_500,
    overallTimeout = 45_000,
    currentlySelected,
    scope = '',
  } = opts;
  const { page } = term;
  const currentlySelectedLocator: Locator =
    currentlySelected ??
    page.locator('.term-row', { hasText: new RegExp(`[${SELECTED}]`) });
  const start = Date.now();
  let pressesSent = 0;
  let stoppedBy: 'bound' | 'deadline' = 'bound';

  for (let i = 0; i <= maxPresses; i++) {
    try {
      await selectedLocator
        .first()
        .waitFor({ state: 'visible', timeout: stepTimeout });
      return;
    } catch {
      if (i === maxPresses) break;
      if (Date.now() - start > overallTimeout) {
        stoppedBy = 'deadline';
        break;
      }
      await term.press(key);
      pressesSent += 1;
    }
  }

  throw new Error(
    await walkFailure({
      subject,
      what,
      scope,
      key,
      stoppedBy,
      maxPresses,
      overallTimeout,
      pressesSent,
      currentlySelected: currentlySelectedLocator,
    })
  );
}

interface WalkFailure {
  subject: string;
  what: string;
  scope: string;
  key: string;
  stoppedBy: 'bound' | 'deadline';
  maxPresses: number;
  overallTimeout: number;
  pressesSent: number;
  currentlySelected: Locator;
}

/**
 * Build the message for a walk that never landed.
 *
 * The two exits mean different things and must read differently: a
 * bound that ran out says the target is wrong or out of reach, while a
 * deadline that expired says the app is slow or wedged. Naming the
 * wrong one sends the reader down the wrong path, which is the failure
 * this whole helper exists to stop.
 */
async function walkFailure(f: WalkFailure): Promise<string> {
  const limitClause =
    f.stoppedBy === 'bound'
      ? `exhausted its bound of ${f.maxPresses} presses`
      : `ran out of its ${f.overallTimeout}ms budget after ` +
        `${f.pressesSent} presses`;
  // Exhausting the bound does not prove the row is absent: the walk only
  // travels one way and the underlying selection clamps, so a row above
  // the starting selection is unreachable however long we press. Say so,
  // or the reader re-runs the test hunting a row that was there. A
  // deadline says nothing about direction, so it gets no hint.
  const directionHint =
    f.stoppedBy === 'bound'
      ? `\nThe walk only moves one way; a row above the starting selection ` +
        `is not reachable with '${f.key}'.`
      : '';
  const selected = await describeSelectedRow(f.currentlySelected);
  return (
    `${f.subject} never reached "${f.what}": ${limitClause}${f.scope}.\n` +
    `Selected instead: ${selected}` +
    directionHint
  );
}
