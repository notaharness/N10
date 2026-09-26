import { mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test as base, expect } from './fixtures/desktop.js';
import { expectAdjoining, tab, tabs, visibleText } from './setup/app.js';
import { cleanupExternalSessions, tmuxAvailable } from './setup/external.js';
import { cleanupTestRepo, createTestRepo } from './setup/git-repo.js';

/**
 * Quit with agents open across two repositories, relaunch on one of
 * them: both agents are still running in tmux, and both get their tabs
 * back — the open repository's through discovery, the other's as a
 * strip entry in its own group that opens that repository when clicked.
 */
const ALPHA = 'e2e-ext-alpha-restored';
const BETA = 'e2e-ext-beta-restored';

function agentCommand(banner: string): string {
  return `printf '%s\\n' ${banner}; sleep 300`;
}

// Both repositories are fixtures rather than describe-scope constants,
// so they exist only for a test that asks — and are cleaned up only
// then too (see terminal-tabs-tmux.test.ts for why).
const test = base.extend<{ other: string; alphaLink: string }>({
  // eslint-disable-next-line no-empty-pattern -- Playwright fixture signature
  other: async ({}, provide) => {
    const dir = createTestRepo({ name: 'repo-beta' });
    await provide(dir);
    cleanupTestRepo(dir);
  },
  // The repository the app opens on is reached through a symlink. Its
  // identity everywhere else — the tmux prefix, a worktree's origin,
  // the foreign listing — is the real path, so the app has to settle
  // on that one at the door or the same repository is two on the strip.
  // eslint-disable-next-line no-empty-pattern -- Playwright fixture signature
  alphaLink: async ({}, provide) => {
    const real = createTestRepo({ name: 'repo-alpha' });
    const linkDir = mkdtempSync(join(tmpdir(), 'n10-desktop-e2e-link-'));
    const link = join(linkDir, 'repo-alpha');
    symlinkSync(real, link);
    await provide(link);
    rmSync(linkDir, { recursive: true, force: true });
    cleanupTestRepo(real);
  },
  repoPathOverride: async ({ alphaLink }, provide) => {
    await provide(alphaLink);
  },
  liveSessions: async ({ other }, provide) => {
    await provide([
      { branch: ALPHA, command: agentCommand('alpha-agent-here') },
      { branch: BETA, command: agentCommand('beta-agent-here'), repo: other },
    ]);
  },
});

test.skip(!tmuxAvailable(), 'tmux is not installed');

test.afterEach(({ desktop, other }) => {
  cleanupExternalSessions(desktop.repoPath, [ALPHA], desktop.homeDir);
  cleanupExternalSessions(other, [BETA], desktop.homeDir);
});

test.describe('Agents restored across repositories', () => {
  test('every repository’s live agent gets its tab back in its own group', async ({
    desktop,
    other,
  }) => {
    const { page, repoPath } = desktop;
    const getRepo = () => page.evaluate(() => window.n10.getRepo());
    // Opened through a symlink, known by its real path.
    const alphaRoot = realpathSync(repoPath);

    // The open repository's agent: attached, and on the strip.
    await expect(tab(page, new RegExp(ALPHA))).toBeVisible({
      timeout: 30_000,
    });
    // The other repository's: on the strip in its group, prefixed with
    // that repository's name — and the workspace stayed where it opened.
    const beta = tab(page, new RegExp(`repo-beta\\s*/\\s*${BETA}`));
    await expect(beta).toBeVisible({ timeout: 30_000 });
    // Two repositories' tabs in one continuous row, with no gap or
    // divider between the groups.
    await expect(tabs(page)).toHaveCount(2);
    const [left, right] = [tabs(page).first(), tabs(page).last()];
    await expectAdjoining(left, right);
    expect(await getRepo()).toMatchObject({ cwd: alphaRoot });

    // Activating it opens its repository, whose own discovery attaches
    // the agent that was running there all along.
    await beta.click();
    await expect
      .poll(getRepo, { timeout: 30_000 })
      .toMatchObject({ cwd: realpathSync(other) });
    await expect(visibleText(page, 'beta-agent-here')).toBeVisible({
      timeout: 30_000,
    });
    // One tab for that agent, not a second one opened by the switch.
    await expect(tab(page, new RegExp(BETA))).toHaveCount(1);

    // From here alpha's agent is the foreign one, described by the real
    // path. Once that listing has landed, it is still the tab alpha
    // already had — not a second one in a group of its own, which is
    // what a repository identified by the path it was opened through
    // gets the moment its agents are described by the real one.
    await expect
      .poll(() => page.evaluate(() => window.n10.listForeignSessions()), {
        timeout: 30_000,
      })
      .toEqual([expect.objectContaining({ repo: alphaRoot, branch: ALPHA })]);
    await expect(tab(page, new RegExp(ALPHA))).toHaveCount(1);
    await expect(tabs(page)).toHaveCount(2);

    // …and back, by alpha's own tab: still one tab per agent, and the workspace on the same repository it opened on.
    await tab(page, new RegExp(ALPHA)).click();
    await expect
      .poll(getRepo, { timeout: 30_000 })
      .toMatchObject({ cwd: alphaRoot });
    await expect(visibleText(page, 'alpha-agent-here')).toBeVisible({
      timeout: 30_000,
    });
    await expect(tab(page, new RegExp(ALPHA))).toHaveCount(1);
    await expect(tab(page, new RegExp(BETA))).toHaveCount(1);
    await expect(tabs(page)).toHaveCount(2);
  });
});
