import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from './fixtures/n10.js';
import type { N10Term } from './fixtures/n10.js';
import { registerCleanup } from './setup/git-repo.js';
import { selectSidebarRow } from './setup/sidebar.js';
import { pressUntilSelected } from './setup/selection.js';
import { TEST_REPO } from './setup/constants.js';

// Exercises the "add comments to a plan" (add-to-cart) feature against
// fixture PR #38 (undo feature), which has inline review comments on
// src/undo.c. Stops at the checkout pane — pressing "send" would spawn a
// real `claude`, which isn't available in CI. The unit specs cover the
// send/orchestration paths (checkout-orchestrator.spec.ts).

const hasGhToken = !!process.env.GH_TOKEN;

const cloneDir = mkdtempSync(join(tmpdir(), 'n10-plan-clone-'));
registerCleanup(cloneDir);

if (hasGhToken) {
  const token = process.env.GH_TOKEN;
  execSync(`gh repo clone "${TEST_REPO}" "${cloneDir}"`, { stdio: 'pipe' });
  execSync(
    `git remote set-url origin "https://x-access-token:${token}@github.com/${TEST_REPO}.git"`,
    { cwd: cloneDir, stdio: 'pipe' }
  );
  execSync('git config user.email "e2e@n10.dev"', {
    cwd: cloneDir,
    stdio: 'pipe',
  });
  execSync('git config user.name "n10 E2E"', { cwd: cloneDir, stdio: 'pipe' });
  execSync('git fetch origin fixture/add-undo-feature', {
    cwd: cloneDir,
    stdio: 'pipe',
  });
}

test.describe('@integration Plan Checkout', () => {
  test.skip(!hasGhToken, 'Requires GH_TOKEN for real GitHub ops');

  test.use({
    n10RepoPath: cloneDir,
    n10Config: { keybindPreset: 'vim' },
    rows: 60,
    cols: 120,
  });

  async function openPr38DiffAndSelectThread(n10: { term: N10Term }) {
    await expect(n10.term.getByText('n10').first()).toBeVisible();
    await expect(
      n10.term.getByText('Add undo feature with history stack').first()
    ).toBeVisible({ timeout: 30_000 });

    await selectSidebarRow(n10.term, 'Add undo feature');

    await n10.term.press('d');
    await n10.term.page
      .locator('.term-row', { hasText: /undo\.c/ })
      .first()
      .waitFor({ state: 'visible', timeout: 30_000 });

    const undoSelected = n10.term.page
      .locator('.term-row', { hasText: /›.*undo\.c/ })
      .first();
    await pressUntilSelected(n10.term, undoSelected, 10, {
      what: 'src/undo.c in the diff file list',
      currentlySelected: n10.term.page.locator('.term-row', {
        hasText: '›',
      }),
    });

    await n10.term.press('Enter');
    await expect(n10.term.getByText(/Magic number/).first()).toBeVisible({
      timeout: 30_000,
    });

    // Select the first remote thread (vim: c = next-comment). The
    // [r]eply hint confirms the selection committed.
    await n10.term.press('c');
    await expect(n10.term.getByText(/\[r\]eply/).first()).toBeVisible({
      timeout: 10_000,
    });
  }

  test('add a comment to the plan, annotate it, and open checkout', async ({
    n10,
  }) => {
    await openPr38DiffAndSelectThread({ term: n10.term });

    // `a` adds the selected thread to the plan — the top-right indicator
    // shows "Plan (1)".
    await n10.term.press('a');
    await expect(n10.term.getByText(/Plan \(1\)/).first()).toBeVisible({
      timeout: 10_000,
    });

    // `o` (vim checkout) opens the interactive checklist pane.
    await n10.term.press('o');
    await expect(n10.term.getByText(/Plan Checkout \(1\)/).first()).toBeVisible(
      { timeout: 10_000 }
    );
    await expect(n10.term.getByText(/undo\.c:/).first()).toBeVisible({
      timeout: 5_000,
    });

    // Esc returns to the diff, plan intact.
    await n10.term.press('Escape');
    await expect(n10.term.getByText(/Plan \(1\)/).first()).toBeVisible({
      timeout: 5_000,
    });
  });

  test('toggling a comment off removes it from the plan', async ({ n10 }) => {
    await openPr38DiffAndSelectThread({ term: n10.term });

    await n10.term.press('a');
    await expect(n10.term.getByText(/Plan \(1\)/).first()).toBeVisible({
      timeout: 10_000,
    });

    // Second `a` toggles it back off — the indicator disappears.
    await n10.term.press('a');
    await expect(n10.term.getByText(/Plan \(1\)/)).not.toBeVisible({
      timeout: 10_000,
    });
  });
});
