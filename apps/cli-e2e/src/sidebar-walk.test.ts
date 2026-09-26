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
  test('reaches a row above the starting selection, then one below', async ({
    n10,
  }) => {
    await expect(n10.term.getByText('n10').first()).toBeVisible();
    await expect(n10.term.getByText('(no sessions)')).toBeVisible();

    await createSession(n10.term, 'walk-a');
    await createSession(n10.term, 'walk-b');
    await createSession(n10.term, 'walk-c');

    // Creation leaves the newest session selected and 'walk-c' sorts
    // last, so the cursor starts at the BOTTOM of the list — the same
    // shape as a cursor that drifted downward while the review list
    // loaded. Walking DOWN to 'walk-a' from there is impossible without
    // the rewind, and this exact case did fail that way before
    // `rewindToTop` existed: "exhausted its bound of 14 presses across
    // 4 settled sidebar rows. Selected instead: walk-c". This is the
    // regression test for that drift — do not "fix" it by walking up.
    await selectSidebarRow(n10.term, 'walk-a');

    await expect(
      sidebarLocator(n10.term.page, 'walk-a').selected().first()
    ).toBeVisible();

    // Then back down to the last row, so the downward walk is doing
    // real work rather than the rewind alone landing on row one.
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
