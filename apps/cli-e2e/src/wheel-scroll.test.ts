import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from './fixtures/n10.js';
import type { N10Term } from './fixtures/n10.js';
import { registerCleanup } from './setup/git-repo.js';
import { selectSidebarRow } from './setup/sidebar.js';
import { pressUntilSelected } from './setup/selection.js';
import { pressUntil } from './setup/sessions.js';
import { TEST_REPO, wtermHost } from './setup/constants.js';

// Mouse-wheel scrolling in the diff viewer. The browser terminal has
// no mouse reporting, so raw SGR wheel sequences are injected into
// stdin via term.write() — exactly the bytes a real terminal sends —
// and asserted through the resulting viewport state plus the DECSET
// mouse-mode bytes n10 emits (read back via GET /output).

const hasGhToken = !!process.env.GH_TOKEN;

// Pointer at column 80 — inside the main pane. The sidebar owns
// columns 1-48 and scrolls its own selection.
const WHEEL_DOWN = '\x1b[<65;80;12M';
const WHEEL_UP = '\x1b[<64;80;12M';
const SIDEBAR_WHEEL_DOWN = '\x1b[<65;10;12M';

const cloneDir = mkdtempSync(join(tmpdir(), 'n10-wheel-clone-'));
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
  execSync('git config user.name "n10 E2E"', {
    cwd: cloneDir,
    stdio: 'pipe',
  });
  execSync('git fetch origin fixture/add-color-support', {
    cwd: cloneDir,
    stdio: 'pipe',
  });
}

async function rawOutput(baseURL: string | undefined): Promise<string> {
  const res = await fetch(`${wtermHost(baseURL)}/output`);
  const { base64 } = (await res.json()) as { base64: string };
  return Buffer.from(base64, 'base64').toString('latin1');
}

test.describe('@integration Wheel scrolling', () => {
  test.skip(!hasGhToken, 'Requires GH_TOKEN for real GitHub ops');

  test.use({
    n10RepoPath: cloneDir,
    n10Config: { keybindPreset: 'vim' },
    rows: 40,
    cols: 120,
  });

  async function openColorSupportDiff(n10: { term: N10Term }) {
    await expect(
      n10.term.getByText('Add color support for tile values').first()
    ).toBeVisible({ timeout: 30_000 });
    await selectSidebarRow(n10.term, 'Add color support');
    // Input can arrive before Ink's new selection handler is committed.
    // Opening the diff is idempotent; retry until its file list confirms it.
    await pressUntil(
      n10.term,
      'd',
      () =>
        n10.term.page
          .locator('.term-row', { hasText: /render\.c/ })
          .first()
          .isVisible(),
      { timeout: 40_000 }
    );

    // PR #37 touches two files: colors.h (a 24-line new file) and
    // render.c (52 lines, shown with full-file context). Only render.c
    // is taller than the diff viewer's viewport, so it's the one that
    // must be opened for a wheel-scroll assertion — colors.h fits
    // entirely and would never show a "rows above" indicator no matter
    // how scrolling behaves. Longer timeout on the first wait: cold
    // diff fetches on CI can take 15-25s.
    await n10.term.page
      .locator('.term-row', { hasText: /render\.c/ })
      .first()
      .waitFor({ state: 'visible', timeout: 30_000 });

    // Navigate the file-list selection onto render.c — the selected
    // row carries the '›' prefix (DiffFileList.tsx).
    const renderSelected = n10.term.page
      .locator('.term-row', { hasText: /›.*render\.c/ })
      .first();
    await pressUntilSelected(n10.term, renderSelected, 10, {
      what: 'render.c in the diff file list',
      currentlySelected: n10.term.page.locator('.term-row', { hasText: '›' }),
    });
  }

  test('wheel events scroll the diff viewer', async ({ n10, baseURL }) => {
    await openColorSupportDiff(n10);
    await n10.term.press('Enter');
    await expect(
      n10.term.page.locator('.term-row', { hasText: /@@.*@@/ }).first()
    ).toBeVisible({ timeout: 30_000 });

    // n10 enables SGR button-event mouse tracking for the viewer.
    expect(await rawOutput(baseURL)).toContain('\x1b[?1000h\x1b[?1006h');
    await expect(n10.term.getByText('rows above')).toBeHidden();

    // A batched chunk of wheel-down events must all be consumed (the
    // pre-2026 parser took one event per chunk).
    await n10.term.write(WHEEL_DOWN + WHEEL_DOWN + WHEEL_DOWN);
    await expect(n10.term.getByText('rows above').first()).toBeVisible({
      timeout: 10_000,
    });

    for (let i = 0; i < 5; i++) await n10.term.write(WHEEL_UP);
    await expect(n10.term.getByText('rows above')).toBeHidden({
      timeout: 10_000,
    });

    // A wheel event over the sidebar region must NOT scroll the diff.
    await n10.term.write(SIDEBAR_WHEEL_DOWN);
    await expect(n10.term.getByText('rows above')).toBeHidden();
  });

  test('mouse clicks do not leak into compose input', async ({ n10 }) => {
    await openColorSupportDiff(n10);
    // A stray click while the diff list is focused must not act as
    // input — the SGR bytes previously reached Ink as garbage
    // keypresses.
    await n10.term.write('\x1b[<0;10;5M\x1b[<0;10;5m');
    await expect(
      n10.term.page.locator('.term-row', { hasText: /\.(c|h)\b/ }).first()
    ).toBeVisible();
  });
});
