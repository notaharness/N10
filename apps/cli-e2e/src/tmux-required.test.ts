import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, fakeAgentCommand } from './fixtures/n10.js';
import { createSession } from './setup/sessions.js';
import { n10SessionExists, uniqueTmuxBranch } from './setup/tmux.js';

for (const legacyBackend of [undefined, 'pty']) {
  test.describe(`Required tmux (stored backend: ${
    legacyBackend ?? 'absent'
  })`, () => {
    test.use({
      n10Config: {
        aiCommand: fakeAgentCommand({ silent: true }),
        terminalBackend: legacyBackend,
      },
    });

    test('launches an agent in tmux', async ({ n10 }) => {
      const branch = uniqueTmuxBranch();
      await createSession(n10.term, branch, { start: true });
      await expect(
        n10.term.getByText('n10-fake-agent-ready').first()
      ).toBeVisible({ timeout: 20_000 });
      expect(n10SessionExists(branch, n10.homeDir)).toBe(true);
    });
  });
}

test('reports the tmux requirement before rendering when tmux is missing', () => {
  const homeDir = mkdtempSync(join(tmpdir(), 'n10-e2e-web-home-'));
  try {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HOME: homeDir,
      PATH: homeDir,
      TMUX_TMPDIR: homeDir,
    };
    delete env.TMUX;
    delete env.TMUX_PANE;
    const binary = fileURLToPath(
      new URL('../../cli/dist/main.js', import.meta.url)
    );
    const result = spawnSync(process.execPath, [binary, '--tui', homeDir], {
      env,
      encoding: 'utf8',
      timeout: 10000,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('n10 requires tmux 3.2 or newer');
    expect(result.stderr).toMatch(/install/i);
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }
});
