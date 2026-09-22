import { execSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test, expect } from './fixtures/n10.js';
import { registerCleanup } from './setup/git-repo.js';
import { selectSidebarRow } from './setup/sidebar.js';
import { pressUntilSelected } from './setup/selection.js';
import { TEST_REPO } from './setup/constants.js';

const hasGhToken = !!process.env.GH_TOKEN;

// Module-scope clone so all tests share one full local repo. Reads
// only — no branches/PRs created.
const cloneDir = mkdtempSync(join(tmpdir(), 'n10-auto-select-clone-'));
registerCleanup(cloneDir);

interface DiscoveredThread {
  path: string;
  line: number;
  body: string;
}

let firstInlineThread: DiscoveredThread | null = null;

if (hasGhToken) {
  const token = process.env.GH_TOKEN;

  // Full clone (no --single-branch) so n10's diff path can resolve
  // origin/<source> + origin/<target> for any fixture branch.
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
  // Pre-fetch PR #38's source branch so the diff viewer hits a local
  // remote-tracking ref immediately (avoids a slow first paint while
  // the PR's source branch fetches).
  execSync('git fetch origin fixture/add-undo-feature', {
    cwd: cloneDir,
    stdio: 'pipe',
  });

  // Discover one of PR #38's inline-comment threads — file path, line
  // number, and the body so we have a unique anchor to assert on.
  // Comment-fixture tests can drift PR #38's review state but the
  // inline comment threads themselves are stable.
  const raw = execSync(
    `gh api "repos/${TEST_REPO}/pulls/38/comments" --paginate`,
    {
      encoding: 'utf8',
    }
  );
  interface GhComment {
    path: string;
    line?: number | null;
    original_line?: number | null;
    body?: string;
    in_reply_to_id?: number | null;
  }
  const all = JSON.parse(raw) as GhComment[];
  // Skip replies; pick the first top-level inline comment with a line.
  const top = all.find((c) => !c.in_reply_to_id && (c.line ?? c.original_line));
  if (top) {
    firstInlineThread = {
      path: top.path,
      line: (top.line ?? top.original_line)!,
      body: (top.body ?? '').slice(0, 30),
    };
  }
}

test.describe('@integration Auto-select first comment', () => {
  test.skip(!hasGhToken, 'Requires GH_TOKEN for real GitHub ops');

  test.use({
    n10RepoPath: cloneDir,
    n10Config: { keybindPreset: 'vim' },
    rows: 60,
    cols: 140,
  });

  test('opens PR #38 file with inline comments — at least one thread auto-selects', async ({
    n10,
  }) => {
    test.skip(
      !firstInlineThread,
      'No inline comments discovered on fixture PR #38 — fixture changed?'
    );

    await expect(n10.term.getByText('n10').first()).toBeVisible();
    await expect(
      n10.term.getByText('Add undo feature with history stack').first()
    ).toBeVisible({ timeout: 30_000 });

    // Walk to PR #38 row (PRs sit after worktrees; press j until the
    // sidebar selection icon lands on the row).
    await selectSidebarRow(n10.term, 'Add undo feature');

    // Open the PR's file list.
    await n10.term.press('d');
    await n10.term.page
      .locator('.term-row', { hasText: /\.(c|h)\b/ })
      .first()
      .waitFor({ state: 'visible', timeout: 30_000 });

    // Walk down to the file containing the discovered thread, then
    // press Enter to open it in the diff viewer.
    const fileBasename = firstInlineThread!.path.split('/').pop()!;
    const fileRow = n10.term.page
      .locator('.term-row', { hasText: fileBasename })
      .first();
    await fileRow.waitFor({ state: 'visible', timeout: 10_000 });

    // Walk the diff-list selection down until our target file row is
    // selected (carries the leading `›` marker). Reuse pressUntilSelected
    // — it waits for the selected-row locator per press instead of
    // `count() > 0` + sleep, which races wterm's render and can fire
    // Enter before the cursor finishes moving.
    const fileSelected = n10.term.page
      .locator('.term-row')
      .filter({ hasText: '›' })
      .filter({ hasText: fileBasename })
      .first();
    await pressUntilSelected(n10.term, fileSelected, 40, {
      what: `${fileBasename} in the diff file list`,
      currentlySelected: n10.term.page.locator('.term-row', {
        hasText: '›',
      }),
    });

    await n10.term.press('Enter');

    // No separate "@@ hunk header" wait — auto-select scrolls past
    // the header within milliseconds of the diff loading, racing the
    // assertion. The [r]eply check below proves both that the diff
    // rendered and that auto-select fired (it's a strict superset).

    // Auto-select fired ⇔ exactly one thread is currently selected
    // ⇔ the `[r]eply` hint is on screen. CommentThread.tsx renders
    // `[r]eply` inline in the card header *only* when
    // `selected && !isReplying`, so its presence anywhere is the
    // assertion the test name promises ("at least one thread
    // auto-selects").
    //
    // We deliberately do NOT assert on `firstInlineThread.body` here.
    // Discovery uses the REST `pulls/{n}/comments` endpoint while n10
    // fetches via the GraphQL `reviewThreads` field, and the two can
    // disagree on PR #38 (e.g. an orphan inline comment that's a
    // "review comment" in REST but not part of any reviewThread). That
    // disagreement is a separate product question — not what this test
    // is checking.
    await expect(
      n10.term.page.locator('.term-row', { hasText: '[r]eply' }).first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test('posted local comment at navPool[0] does not block auto-select (regression for dead-id bug)', async ({
    n10,
  }) => {
    const { homeDir } = n10;
    test.skip(
      !firstInlineThread,
      'No inline comments discovered on fixture PR #38 — fixture changed?'
    );

    // Seed a posted local entry on the same file as the remote thread
    // but BEFORE its line, so the navPool would sort it to index 0.
    // Pre-fix bug: `commentPositions` doesn't carry posted-local ids
    // (interleaveComments drops them), so `info` is undefined,
    // `rowEntry` is undefined, and the auto-select effect bails
    // forever — no thread gets selected.
    const reviewsDir = join(homeDir, '.n10', 'reviews', 'pr-38');
    mkdirSync(reviewsDir, { recursive: true });
    const seededLine = Math.max(1, firstInlineThread!.line - 5);
    const file = {
      version: 1 as const,
      comments: [
        {
          id: 'seeded-posted-regression-guard',
          file: firstInlineThread!.path,
          lineStart: seededLine,
          lineEnd: seededLine,
          severity: 'minor' as const,
          body: 'Seeded posted local — should be filtered from navPool',
          side: 'RIGHT' as const,
          status: 'posted' as const,
          createdAt: new Date().toISOString(),
        },
      ],
    };
    writeFileSync(
      join(reviewsDir, 'comments.json'),
      JSON.stringify(file, null, 2),
      'utf8'
    );

    await expect(n10.term.getByText('n10').first()).toBeVisible();
    await expect(
      n10.term.getByText('Add undo feature with history stack').first()
    ).toBeVisible({ timeout: 30_000 });

    await selectSidebarRow(n10.term, 'Add undo feature');
    await n10.term.press('d');
    await n10.term.page
      .locator('.term-row', { hasText: /\.(c|h)\b/ })
      .first()
      .waitFor({ state: 'visible', timeout: 30_000 });

    // Walk the diff-list selection down until our target file row is
    // selected (carries the leading `›` marker). Same race-tolerant
    // helper as the sibling test above — see comment there for why
    // chained string filters and pressUntilSelected matter.
    const fileBasename = firstInlineThread!.path.split('/').pop()!;
    const fileSelected = n10.term.page
      .locator('.term-row')
      .filter({ hasText: '›' })
      .filter({ hasText: fileBasename })
      .first();
    await pressUntilSelected(n10.term, fileSelected, 40, {
      what: `${fileBasename} in the diff file list`,
      currentlySelected: n10.term.page.locator('.term-row', {
        hasText: '›',
      }),
    });
    await n10.term.press('Enter');

    // Pre-fix the seeded dead local id sat at navPool[0] and
    // permanently gated `autoSelectedFileRef` — no `[r]eply` would
    // appear because nothing was selected. Post-fix the navPool
    // filters posted-status entries and the remote thread takes the
    // first slot, so `[r]eply` shows up on whichever thread n10
    // auto-selects. We assert only on `[r]eply` (not the discovered
    // body): see the sibling test above for why discovery and n10's
    // GraphQL fetch can disagree on PR #38's threads.
    await expect(
      n10.term.page.locator('.term-row', { hasText: '[r]eply' }).first()
    ).toBeVisible({ timeout: 10_000 });
  });
});
