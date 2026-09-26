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

// Exercises the remote-comment sync feature end-to-end against the
// fixture PR #38 (undo feature), which has 3 inline review comments.

const hasGhToken = !!process.env.GH_TOKEN;

const cloneDir = mkdtempSync(join(tmpdir(), 'n10-comments-clone-'));
registerCleanup(cloneDir);

if (hasGhToken) {
  const token = process.env.GH_TOKEN;
  // Full clone (no --single-branch): the diff viewer resolves both
  // source and target refs, so it needs all fixture branches available.
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
  execSync('git fetch origin fixture/add-undo-feature', {
    cwd: cloneDir,
    stdio: 'pipe',
  });
}

// Each CI run's reply test leaves a new `e2ereply*`-body comment on
// PR #38. Without cleanup, thread 1 grows unbounded — after a few
// runs its rendered box is tall enough to scroll thread 2 below the
// viewport, and subsequent tests that expect thread 2's body to be
// visible start flaking.
//
// Sweep these out before every run. Tests 1/2 get a clean thread;
// test 4 will add its own marker during execution (and the next run
// will sweep it).
function cleanupAccumulatedReplies(): void {
  if (!hasGhToken) return;
  const [owner, name] = TEST_REPO.split('/');
  if (!owner || !name) return;
  // Defensive: only pass safe identifier chars into the inline query
  // string since we're templating into a single-quoted shell arg.
  const safeId = /^[A-Za-z0-9._-]+$/;
  if (!safeId.test(owner) || !safeId.test(name)) return;
  try {
    const listRes = execSync(
      `gh api graphql -f query='{ repository(owner:"${owner}", name:"${name}") { pullRequest(number:38) { reviewThreads(first:10) { nodes { comments(last:20) { nodes { id body } } } } } } }'`,
      { encoding: 'utf8' }
    );
    const parsed = JSON.parse(listRes) as {
      data: {
        repository: {
          pullRequest: {
            reviewThreads: {
              nodes: {
                comments: { nodes: { id: string; body: string }[] };
              }[];
            };
          };
        };
      };
    };
    // Match any of the test-marker shapes used over this feature's
    // development — 'e2ereply' was the original prefix; 'zz' is the
    // current one; '2ereply' matches the pollution left by runs where
    // the leading 'e' of the old marker was dropped by the Ink input
    // race. Sweeping all three keeps the thread clean.
    const looksLikeE2eMarker = (body: string) =>
      body.startsWith('e2ereply') ||
      body.startsWith('2ereply') ||
      body.startsWith('zz');
    const staleIds: string[] = [];
    for (const thread of parsed.data.repository.pullRequest.reviewThreads
      .nodes) {
      for (const c of thread.comments.nodes) {
        if (looksLikeE2eMarker(c.body)) staleIds.push(c.id);
      }
    }
    for (const id of staleIds) {
      try {
        execSync(
          `gh api graphql -f query='mutation($id:ID!){deletePullRequestReviewComment(input:{id:$id}){clientMutationId}}' -f id=${id}`,
          { stdio: 'pipe' }
        );
      } catch {
        // Skip individual failures — best-effort cleanup.
      }
    }
  } catch {
    // Don't fail the test suite if the query itself errors.
  }
}

if (hasGhToken) {
  cleanupAccumulatedReplies();
}

test.describe('@integration Comments Fixture', () => {
  test.skip(!hasGhToken, 'Requires GH_TOKEN for real GitHub ops');

  test.use({
    n10RepoPath: cloneDir,
    n10Config: { keybindPreset: 'vim' },
    rows: 60,
    cols: 120,
  });

  // Helper: select PR #38 in the sidebar, open the file list, navigate
  // the selection onto `src/undo.c` (which has 2 remote inline comments
  // — Makefile and other files have none), then open its diff.
  async function openPr38DiffFileWithComments(n10: { term: N10Term }) {
    await expect(n10.term.getByText('n10').first()).toBeVisible();
    await expect(
      n10.term.getByText('Add undo feature with history stack').first()
    ).toBeVisible({ timeout: 30_000 });

    await selectSidebarRow(n10.term, 'Add undo feature');

    await n10.term.press('d');

    // PR #38 modifies src/undo.c; other fixture PRs don't. So finding
    // undo.c in the file list confirms we opened #38's diff and not a
    // neighbour's (the failure mode under selection drift was opening
    // #39's solver.c/solver.h). Longer timeout than the inner press
    // loop — cold-diff fetches on CI can take 15-25s.
    await n10.term.page
      .locator('.term-row', { hasText: /undo\.c/ })
      .first()
      .waitFor({ state: 'visible', timeout: 30_000 });

    // Navigate the file-list selection onto src/undo.c. The selected
    // row carries the '›' prefix (DiffFileList.tsx:44). Same race
    // applies — use pressUntilSelected so each press settles.
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
    await expect(n10.term.getByText('(no diff for this file)')).not.toBeVisible(
      { timeout: 30_000 }
    );
  }

  test('PR #38 diff viewer shows inline remote comments with author and body', async ({
    n10,
  }) => {
    await openPr38DiffFileWithComments({ term: n10.term });

    // kirby-test-runner authored both inline comments on src/undo.c.
    // This is "another user" from the PR author's perspective
    // (PR #38 is authored by HermannBjorgvin).
    await expect(n10.term.getByText('kirby-test-runner').first()).toBeVisible({
      timeout: 15_000,
    });

    // Body of the first undo.c comment (line 9) should be rendered
    // verbatim — at least the opening phrase. Proves n10 pulls the
    // real comment content, not just the author.
    await expect(n10.term.getByText(/Magic number/).first()).toBeVisible({
      timeout: 5_000,
    });
  });

  test('cycling through remote threads with c reveals each comment body', async ({
    n10,
  }) => {
    await openPr38DiffFileWithComments({ term: n10.term });

    // Wait for the first comment to render.
    await expect(n10.term.getByText(/Magic number/).first()).toBeVisible({
      timeout: 15_000,
    });

    // src/undo.c has 2 inline comments. Selecting the first thread
    // (c in vim preset) expands its body — and the "[r]eply [v]resolve"
    // hint appears in the header, confirming the selection landed.
    await n10.term.press('c');
    await expect(n10.term.getByText(/\[r\]eply/).first()).toBeVisible({
      timeout: 5_000,
    });

    // Press c again to cycle to the second thread. Its body mentions
    // inconsistent parameter naming.
    await n10.term.press('c');
    await expect(
      n10.term.getByText(/Inconsistent parameter/).first()
    ).toBeVisible({ timeout: 5_000 });
  });

  test('selecting a remote thread and pressing v toggles resolved state', async ({
    n10,
  }) => {
    await openPr38DiffFileWithComments({ term: n10.term });

    // Wait for remote comment fetch to populate — pressing 'c' before
    // threads render is a no-op (nothing to select, no hint appears).
    await expect(n10.term.getByText(/Magic number/).first()).toBeVisible({
      timeout: 15_000,
    });

    // c = next-comment in vim preset. Wait for the selected-thread
    // indicator ("[r]eply [v]resolve/reopen" hint) before pressing 'v'
    // — without this pause, 'v' reads a stale selectedCommentId and
    // finds no thread to resolve.
    await n10.term.press('c');
    await expect(n10.term.getByText(/\[r\]eply/).first()).toBeVisible({
      timeout: 10_000,
    });

    await n10.term.press('v');
    await expect(
      n10.term.getByText(/Resolving|Resolved|Reopening|Reopened/).first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test('posting a reply makes it appear in the thread with the replier as author', async ({
    n10,
  }) => {
    await openPr38DiffFileWithComments({ term: n10.term });

    // Wait for remote comments to load, then select the first thread
    // and wait for the selection to commit before pressing 'r'.
    await expect(n10.term.getByText('kirby-test-runner').first()).toBeVisible({
      timeout: 15_000,
    });
    await n10.term.press('c');
    await expect(n10.term.getByText(/\[r\]eply/).first()).toBeVisible({
      timeout: 10_000,
    });

    // Unique marker. Two defensive choices:
    //  - 'zz' prefix: 'z' isn't bound to any single-key action in the
    //    diff-viewer, so if Ink's useInput briefly holds the pre-reply
    //    closure (observed on CI: first keystroke after 'r' routes to
    //    the old handler), a leading 'z' is a no-op keybind rather
    //    than being swallowed by e.g. 'e' (edit-comment).
    //  - `uniquePart` is what we search for afterward. Isolating the
    //    unique substring from the prefix means the assertion still
    //    matches even if the first 'z' is dropped.
    const uniquePart = `${Date.now().toString(36)}reply`;
    const marker = `zz${uniquePart}`;

    await n10.term.press('r');
    await expect(n10.term.getByText('REPLY').first()).toBeVisible({
      timeout: 5_000,
    });

    // 50ms/key leaves enough settling time for each keystroke without
    // pushing the test out past the network timeout. (10ms dropped
    // characters on CI under load.)
    await n10.term.type(marker, { delay: 50 });
    await n10.term.press('Enter');

    // Flash confirms the API round-trip completed. Allow either the
    // success or failure message — a network stall on CI can easily
    // push this past a strict 'Reply posted' match, and the stricter
    // version hid the failure signal ("Reply posted" never shown,
    // 20s timeout fired). 30s covers slow GitHub round-trips; a
    // failure flash short-circuits the rest of the assertions.
    const flashLocator = n10.term.getByText(/Reply (posted|failed)/).first();
    await expect(flashLocator).toBeVisible({ timeout: 30_000 });

    // Guard: treat a failure flash as a hard test failure instead of
    // silently swallowing it in the subsequent marker check.
    const failureLocator = n10.term.getByText(/Reply failed/).first();
    await expect(failureLocator).toBeHidden();

    // The reply body must render inline in the thread — search for
    // the unique-part substring (not the full marker) so the check
    // passes even if the leading 'z' was consumed by a stale handler
    // and only 'z<uniquePart>' was appended to the reply buffer.
    await expect(
      n10.term.getByText(new RegExp(uniquePart)).first()
    ).toBeVisible({ timeout: 15_000 });
  });

  test('Shift+C opens the general-comments pane and Esc returns to pr-detail', async ({
    n10,
  }) => {
    // Select PR #38 in the sidebar.
    await expect(n10.term.getByText('n10').first()).toBeVisible();
    await expect(
      n10.term.getByText('Add undo feature with history stack').first()
    ).toBeVisible({ timeout: 30_000 });

    await selectSidebarRow(n10.term, 'Add undo feature');

    // Open the general-comments pane (vim preset binds this to plain C).
    await n10.term.press('C');

    // Either the pane lists PR comments (header "PR Comments") or it
    // shows the empty state — both exercise the routing path.
    await expect(
      n10.term.getByText(/PR Comments|No general comments/).first()
    ).toBeVisible({ timeout: 10_000 });

    // Esc returns to pr-detail — the signature hint line is visible
    // again ("press d to view diff").
    await n10.term.press('Escape');
    await expect(
      n10.term.getByText('press d to view diff').first()
    ).toBeVisible({ timeout: 5_000 });
  });
});
