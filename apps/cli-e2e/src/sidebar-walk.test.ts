import { test, expect } from './fixtures/n10.js';
import {
  selectSidebarRow,
  sidebarLocator,
  sidebarRowCount,
  sidebarWalkBound,
} from './setup/sidebar.js';
import { createSession } from './setup/sessions.js';

// Break-verify for `selectSidebarRow`'s bounded walk (see setup/sidebar.ts).
// These sessions are local — no GitHub, no GH_TOKEN — so this suite is not
// tagged @integration and runs in the plain offline job.

test.use({
  n10Config: {
    aiCommand: 'echo n10-session-active && sleep 300',
    keybindPreset: 'vim',
  },
});

/** Unwrap a `.catch((caught) => caught)` result into a message string. */
function errorMessage(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}

test.describe('Sidebar bounded walk', () => {
  test('walks the selection onto a named row', async ({ n10 }) => {
    await expect(n10.term.getByText('n10').first()).toBeVisible();
    await expect(n10.term.getByText('(no sessions)')).toBeVisible();

    await createSession(n10.term, 'walk-a');
    await createSession(n10.term, 'walk-b');
    await createSession(n10.term, 'walk-c');

    // Creation leaves the newest session selected, and 'walk-c' sorts
    // last, so the selection starts at the bottom of the list. The walk
    // travels one way and `moveSelection` clamps at both ends, so
    // reaching 'walk-a' means walking UP. Doing it with an explicit key
    // both proves the walk moves the selection rather than trivially
    // finding an already-selected row, and covers the `key` option.
    await selectSidebarRow(n10.term, 'walk-a', { key: 'k' });

    await expect(
      sidebarLocator(n10.term.page, 'walk-a').selected().first()
    ).toBeVisible();

    // Now back down with the default 'j', so the default direction is
    // covered end-to-end too. `waitForSidebarSettled` returning at all
    // here is the other half of the check: an offline list never grows,
    // so it must settle rather than poll until its deadline.
    await selectSidebarRow(n10.term, 'walk-c');

    await expect(
      sidebarLocator(n10.term.page, 'walk-c').selected().first()
    ).toBeVisible();
  });

  test('fails with a useful message when the target is unreachable', async ({
    n10,
  }) => {
    await expect(n10.term.getByText('n10').first()).toBeVisible();
    await expect(n10.term.getByText('(no sessions)')).toBeVisible();

    await createSession(n10.term, 'unreach-a');
    await createSession(n10.term, 'unreach-b');

    await expect(selectSidebarRow(n10.term, 'no-such-row-zzz')).rejects.toThrow(
      /no-such-row-zzz/
    );

    const message = await selectSidebarRow(n10.term, 'no-such-row-zzz').then(
      () => '',
      errorMessage
    );
    expect(message).toContain('Selected instead');
    expect(message).toContain('only moves one way');
    // The settled row count appears in the message alongside the
    // limit that ended the walk (bound or deadline) — assert the
    // count itself rather than the surrounding wording, since either
    // limit clause is a valid, correct outcome here.
    const rowCount = await sidebarRowCount(n10.term.page);
    expect(message).toContain(`${rowCount} settled sidebar rows`);
  });
});

test.describe('Sidebar row-count arithmetic', () => {
  test.use({
    // Large enough that 3 sessions plus one section header never
    // scrolls off-window, so sidebarRowCount can be asserted exactly
    // rather than as a bound.
    rows: 40,
  });

  test('counts one section header plus one row per session', async ({
    n10,
  }) => {
    await expect(n10.term.getByText('n10').first()).toBeVisible();
    await expect(n10.term.getByText('(no sessions)')).toBeVisible();

    await createSession(n10.term, 'count-a');
    await createSession(n10.term, 'count-b');
    await createSession(n10.term, 'count-c');

    await expect(
      sidebarLocator(n10.term.page, 'count-c').selected().first()
    ).toBeVisible();

    // 3 sessions, all under "Worktrees" (no PRs without a real remote):
    // one "Worktrees (3)" header row + 3 item rows.
    expect(await sidebarRowCount(n10.term.page)).toBe(4);
  });

  test('sidebarWalkBound pads the settled count with headroom', () => {
    expect(sidebarWalkBound(4)).toBe(14);
    expect(sidebarWalkBound(40)).toBe(60);
  });
});
