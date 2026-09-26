import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/desktop.js';
import { sidebarRow } from './setup/app.js';
import type { FakeGitHub } from './setup/fake-gh.js';

/**
 * The "N unresolved" count in a pull request's header is the way to the
 * threads it counts: clicking it brings the rail's Comments list into
 * view and lands on the first open thread, in the list and in the diff.
 *
 * The rail starts hidden and the target sits far down a long file,
 * behind enough files that its row is below the rail's fold — so each
 * part of "shows it" has to happen for the test to pass.
 */

const BRANCH = 'long-review';
const LINES = 400;
const FILES = 40;

const longFile = Array.from({ length: LINES }, (_, i) => `line ${i + 1}`).join(
  '\n'
);
const padding = Object.fromEntries(
  Array.from({ length: FILES }, (_, i) => [
    `src/a${String(i).padStart(2, '0')}.txt`,
    'x\n',
  ])
);

const GITHUB: FakeGitHub = {
  username: 'n10-tester',
  prs: [
    {
      number: 7,
      title: 'Long review',
      headRefName: BRANCH,
      threads: [
        {
          id: 'T-resolved',
          path: 'z-long.txt',
          line: 5,
          isResolved: true,
          comments: [{ author: 'alice', body: 'Settled already.' }],
        },
        {
          id: 'T-first-open',
          path: 'z-long.txt',
          line: 300,
          comments: [{ author: 'alice', body: 'This one still needs work.' }],
        },
        {
          id: 'T-second-open',
          path: 'z-long.txt',
          line: 380,
          comments: [{ author: 'bob', body: 'And this one.' }],
        },
      ],
    },
  ],
};

test.use({
  fakeGitHub: GITHUB,
  repo: {
    worktrees: [
      { branch: BRANCH, files: { ...padding, 'z-long.txt': `${longFile}\n` } },
    ],
  },
});

async function openPr(page: Page) {
  await sidebarRow(page, /Long review|#7/)
    .first()
    .click();
  const indicator = page.getByRole('button', {
    name: 'Show 2 unresolved comments',
  });
  await expect(indicator).toBeVisible({ timeout: 30_000 });
  return indicator;
}

async function expectFirstOpenThreadShown(page: Page) {
  const row = page.locator('[data-comment-row="T-first-open"]');
  await expect(row).toHaveAttribute('aria-current', 'true');
  await expect(row).toBeInViewport();
  await expect(page.locator('[data-thread="T-first-open"]')).toBeInViewport();
}

test('the unresolved count opens a hidden rail at the first open thread', async ({
  desktop,
}) => {
  const { page } = desktop;
  const indicator = await openPr(page);

  await page.getByRole('button', { name: 'Hide review sidebar' }).click();
  await expect(page.locator('[data-comment-row]')).toHaveCount(0);

  await indicator.click();
  await expectFirstOpenThreadShown(page);
});

test('the unresolved count expands a collapsed Comments list', async ({
  desktop,
}) => {
  const { page } = desktop;
  const indicator = await openPr(page);

  await page.getByRole('button', { name: /^Comments/ }).click();
  await expect(page.locator('[data-comment-row]')).toHaveCount(0);

  await indicator.click();
  await expectFirstOpenThreadShown(page);
});
