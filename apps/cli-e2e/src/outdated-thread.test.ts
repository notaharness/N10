import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from './fixtures/n10.js';
import type { N10Term } from './fixtures/n10.js';
import { registerCleanup } from './setup/git-repo.js';
import { selectSidebarRow } from './setup/sidebar.js';
import { TEST_REPO } from './setup/constants.js';

// Verifies the diff viewer renders outdated review threads inline at
// their `originalLine` instead of dropping them into the
// "comments on lines not in diff" tail.
//
// PR #322 (`fixture/outdated-thread`) is a permanent fixture in the
// test repo: two commits where the second rewrites the function the
// review comment was anchored to, so GitHub flags the thread
// `isOutdated: true` with `line: null` and only `originalLine: 10`
// surviving in the GraphQL response. Without the originalLine
// fallback in the GitHub provider the thread would land in the
// out-of-diff tail and never surface in the inline viewport.

const hasGhToken = !!process.env.GH_TOKEN;

const cloneDir = mkdtempSync(join(tmpdir(), 'n10-outdated-clone-'));
registerCleanup(cloneDir);

if (hasGhToken) {
  const token = process.env.GH_TOKEN;
  // Need both fixture/outdated-thread and main locally — the diff
  // viewer resolves both refs to compute the per-file diff.
  execSync(`gh repo clone "${TEST_REPO}" "${cloneDir}"`, { stdio: 'pipe' });
  execSync(
    `git remote set-url origin "https://x-access-token:${token}@github.com/${TEST_REPO}.git"`,
    { cwd: cloneDir, stdio: 'pipe' }
  );
  execSync('git config user.email "e2e@n10.dev"', {
    cwd: cloneDir,
    stdio: 'pipe',
  });
  execSync('git config user.name "n10 E2E"', {
    cwd: cloneDir,
    stdio: 'pipe',
  });
  execSync('git fetch origin fixture/outdated-thread', {
    cwd: cloneDir,
    stdio: 'pipe',
  });
}

test.describe('@integration Outdated Thread Fixture', () => {
  test.skip(!hasGhToken, 'Requires GH_TOKEN for real GitHub ops');

  test.use({
    n10RepoPath: cloneDir,
    n10Config: { keybindPreset: 'vim' },
    // Pass GH_TOKEN through explicitly so the spawned n10's gh CLI
    // can authenticate even when Playwright reuses a wterm-host that
    // wasn't started with the env (e.g. local dev where the host has
    // been running across shell sessions). The CI runner spawns a
    // fresh host per job, so this is also safe there.
    n10Env: { GH_TOKEN: process.env.GH_TOKEN ?? '' },
    rows: 60,
    cols: 120,
  });

  async function openOutdatedThreadDiff(n10: { term: N10Term }) {
    await expect(n10.term.getByText('n10').first()).toBeVisible();
    await expect(
      n10.term.getByText(/Outdated thread fixture/).first()
    ).toBeVisible({ timeout: 30_000 });

    await selectSidebarRow(n10.term, 'Outdated thread fixture');

    await n10.term.press('d');

    // Wait for the file-list to appear with the fixture file.
    await n10.term.page
      .locator('.term-row', { hasText: /outdated-thread-fixture\.c/ })
      .first()
      .waitFor({ state: 'visible', timeout: 30_000 });

    // Single file in this PR — pressing Enter on the (already-selected)
    // first row opens the diff.
    await n10.term.press('Enter');
    await expect(n10.term.getByText('(no diff for this file)')).not.toBeVisible(
      { timeout: 30_000 }
    );
  }

  test('outdated thread renders inline with the (outdated) tag', async ({
    n10,
  }) => {
    await openOutdatedThreadDiff({ term: n10.term });

    // The fixture comment body — anchored to original line 10. With
    // the originalLine fallback in transformReviewThread, the thread
    // renders inline; without it, the thread would be in the tail
    // section past the end of the diff and this assertion would only
    // pass if the test scrolled to the bottom (it doesn't).
    await expect(
      n10.term
        .getByText(/Fixture comment anchored to the original line 10/)
        .first()
    ).toBeVisible({ timeout: 15_000 });

    // The (outdated) marker is part of the card header. Confirms we
    // propagated `isOutdated: true` through the provider transform.
    await expect(n10.term.getByText(/\(outdated\)/).first()).toBeVisible({
      timeout: 5_000,
    });
  });
});
