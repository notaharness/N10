import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/desktop.js';
import { sidebarRow } from './setup/app.js';
import type { FakeGitHub } from './setup/fake-gh.js';
import { LIFT, motion } from './setup/tab-row.js';

/**
 * The tab row beside the review walkthrough, whose shortcuts listen on
 * `window`: Enter posts the current draft and Escape leaves. A keyboard
 * drag in the row uses the same keys to drop and to cancel, and must
 * not post a comment to the provider on the way — that cannot be taken
 * back. A pointer click on the tab must leave the keys to the pane.
 */

const BRANCH = 'undo-support';
// The walkthrough shows a Conventional Comment's label as a badge, so
// the text asserted on is the body after it.
const FIRST = 'the undo stack is never bounded.';
const SECOND = 'name this something less generic.';

const GITHUB: FakeGitHub = {
  username: 'n10-tester',
  prs: [
    {
      number: 42,
      title: 'Add undo support',
      headRefName: BRANCH,
      body: 'Adds an undo stack.',
      rollup: 'SUCCESS',
    },
  ],
};

const draft = (id: string, severity: string, line: number, body: string) => ({
  id,
  file: 'undo.c',
  lineStart: line,
  lineEnd: line,
  severity,
  body,
  side: 'RIGHT',
  status: 'draft',
  createdAt: '2026-01-01T00:00:00Z',
});

test.use({
  fakeGitHub: GITHUB,
  drafts: {
    42: [
      draft('d1', 'major', 1, `issue: ${FIRST}`),
      draft('d2', 'minor', 2, `suggestion: ${SECOND}`),
    ],
  },
  repo: {
    worktrees: [
      {
        branch: BRANCH,
        files: { 'undo.c': 'void undo(void) {}\nint depth;\n' },
      },
    ],
  },
});

/** The content pane — the rail lists the same drafts beside it. */
const pane = (page: Page) => page.locator('[data-terminal-pane]');

const walkthroughClose = (page: Page) =>
  pane(page).getByRole('button', { name: 'Close', exact: true });

async function openWalkthrough(page: Page) {
  await sidebarRow(page, /Add undo support|#42/)
    .first()
    .click();
  await page
    .getByRole('button', { name: /Review ready/ })
    .first()
    .click({ timeout: 30_000 });
  await expect(
    pane(page).getByText(FIRST).filter({ visible: true })
  ).toBeVisible({ timeout: 30_000 });
}

/** Two frames: what a key set off synchronously has rendered by then. */
function settle(page: Page) {
  return page.evaluate(
    () =>
      new Promise((done) =>
        requestAnimationFrame(() => requestAnimationFrame(done))
      )
  );
}

function statuses(page: Page) {
  return page.evaluate(async () =>
    (
      await (
        window.n10 as never as {
          listDraftComments(prId: number): Promise<{ status: string }[]>;
        }
      ).listDraftComments(42)
    ).map((c) => c.status)
  );
}

/** Lift the active tab by keyboard, and wait until it is lifted. */
async function liftActiveTab(page: Page) {
  const active = page.getByRole('tab', { selected: true });
  await active.focus();
  await page.keyboard.press(LIFT);
  // A sort under way puts a transform on every tab, the lifted one too.
  await expect
    .poll(() => motion(active))
    .toMatchObject({ transform: expect.stringMatching(/^translate3d/) });
}

test.describe('Tab keys beside the review walkthrough', () => {
  test('a keyboard drag’s Enter and Escape neither post nor leave', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await openWalkthrough(page);
    const post = pane(page).getByRole('button', { name: /^Post/ });

    await liftActiveTab(page);
    await page.keyboard.press('Enter');
    await settle(page);
    // A post would have set the button busy and then moved on.
    await expect(post).toBeEnabled();
    await expect(
      pane(page).getByText(FIRST).filter({ visible: true })
    ).toBeVisible();
    expect(await statuses(page)).toEqual(['draft', 'draft']);

    await liftActiveTab(page);
    await page.keyboard.press('Escape');
    await settle(page);
    // Only the walkthrough has a Close button; the diff it would exit
    // to shows the same drafts inline.
    await expect(walkthroughClose(page)).toBeVisible();
  });

  test('after a click on its tab, the walkthrough still takes the arrows', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await openWalkthrough(page);
    await page.getByRole('tab', { selected: true }).click();
    await page.keyboard.press('ArrowRight');
    await expect(
      pane(page).getByText(SECOND).filter({ visible: true })
    ).toBeVisible();
  });
});
