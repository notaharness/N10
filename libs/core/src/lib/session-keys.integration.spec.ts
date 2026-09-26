import * as repoRoot from './repo-root.js';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTmuxBackend } from '@n10/terminal-tmux';
import { orchestraFixture } from '../../tests/orchestra-fixture.js';
import { diffScans } from './discovery/discovery-model.js';
import { getSession, isSessionAlive, killSession } from './pty-registry.js';
import { worktreeSessionKey } from './session-key.js';
import { resetRepoRoot } from './session-backend.js';
import { sessionTags } from './session-identity.js';
import { openSession } from './session/open-session.js';
import { launchTerminalSession } from './terminal/launch-terminal.js';
import { removeWorktreeSession } from './session/remove-worktree.js';

// Real backend and private tmux server; no model or personal sessions involved.
describe.skipIf(spawnSync('tmux', ['-V']).status !== 0)(
  'qualified registry identities',
  () => {
    let fixture: ReturnType<typeof orchestraFixture>;
    beforeEach(() => {
      fixture = orchestraFixture();
      vi.spyOn(repoRoot, 'getRepoRoot').mockReturnValue(fixture.repo);
    });
    afterEach(() => {
      fixture.close();
      vi.restoreAllMocks();
      resetRepoRoot();
    });
    function checkout(branch: string, directory: string, repo = fixture.repo) {
      const path = join(repo, '.claude', 'worktrees', directory);
      execFileSync('git', ['worktree', 'add', '-b', branch, path], {
        cwd: repo,
        stdio: 'ignore',
      });
      return path;
    }
    function worktree(branch: string, cwd: string, repo = fixture.repo) {
      return openSession({
        session: { type: 'worktree', repo, path: cwd, branch },
        cwd,
        cols: 80,
        rows: 24,
        build: () => ({ spec: { cmd: '/bin/sh', args: ['-c', 'sleep 300'] } }),
      });
    }
    function terminal() {
      return launchTerminalSession({
        kind: 'shell',
        cwd: fixture.repo,
        cols: 80,
        rows: 24,
        config: { vendorAuth: {}, vendorProject: {} },
      });
    }
    it('keeps a same-label terminal alive when a worktree is removed, in either creation order', async () => {
      for (const order of ['terminal-first', 'worktree-first']) {
        const branch = 'shop-shell';
        const path = checkout(branch, order);
        const key = worktreeSessionKey(path, fixture.repo);
        const [agent, tab] =
          order === 'terminal-first'
            ? await (async () => {
                const tab = await terminal();
                return [await worktree(branch, path), tab] as const;
              })()
            : ([await worktree(branch, path), await terminal()] as const);
        expect(tab.name).not.toBe(key);
        expect(getSession(key)).toBe(agent);
        expect(getSession(tab.name)).toBe(tab);
        expect(isSessionAlive(key)).toBe(true);
        expect(await removeWorktreeSession(branch, true, fixture.repo)).toBe(
          true
        );
        expect(isSessionAlive(key)).toBe(false);
        expect(isSessionAlive(tab.name)).toBe(true);
        killSession(tab.name);
      }
    });
    it('keeps exact checkouts and repositories separate', async () => {
      const otherRepo = join(fixture.home, 'other');
      mkdirSync(otherRepo);
      execFileSync('git', ['clone', fixture.repo, otherRepo], {
        stdio: 'ignore',
      });
      const cases = [
        { branch: 'feature/login', repo: fixture.repo, directory: 'slash' },
        { branch: 'feature-login', repo: fixture.repo, directory: 'hyphen' },
        { branch: 'feature/login', repo: otherRepo, directory: 'slash' },
      ];
      const keys = await Promise.all(
        cases.map(
          async ({ branch, repo, directory }) =>
            (
              await worktree(branch, checkout(branch, directory, repo), repo)
            ).name
        )
      );
      expect(new Set(keys).size).toBe(3);
      keys.forEach((key) => expect(isSessionAlive(key)).toBe(true));
      killSession(keys[0]);
      expect(isSessionAlive(keys[1])).toBe(true);
      expect(isSessionAlive(keys[2])).toBe(true);
      keys.forEach(killSession);
    });
    it('offers a tagged worktree for discovery even when a same-label terminal is held', async () => {
      const branch = 'shop-shell';
      const path = checkout(branch, 'player');
      const key = worktreeSessionKey(path, fixture.repo);
      const tab = await terminal();
      // A second creator uses the same protocol as Orchestra.
      const external = await createTmuxBackend(
        {
          cmd: '/bin/sh',
          args: ['-c', 'sleep 300'],
          cwd: path,
          cols: 80,
          rows: 24,
        },
        {
          mode: 'create',
          label: 'external-player',
          tags: sessionTags(fixture.repo, {
            type: 'worktree',
            branch,
            worktreePath: path,
          }),
        }
      );
      const delta = diffScans(
        null,
        {
          worktrees: [{ name: key, branch, path }],
          persisted: new Set([key]),
          terminals: [],
        },
        isSessionAlive
      );
      expect(delta.adoptable.map((w) => w.name)).toEqual([key]);
      const adopted = await openSession({
        session: { type: 'worktree', repo: fixture.repo, path },
        mode: 'attach',
        cwd: path,
        cols: 80,
        rows: 24,
        build: () => {
          throw new Error('Attachment must not build a launch command');
        },
      });
      expect(adopted.pty.name).toBe(external.name);
      expect(isSessionAlive(tab.name)).toBe(true);
      external.dispose();
    });
    it('rejects a checkout on another branch before replacing any session', async () => {
      const path = checkout('feature/login', 'login');
      const key = worktreeSessionKey(path, fixture.repo);
      const agent = await worktree('feature/login', path);
      await expect(worktree('feature-login', path)).rejects.toThrow(
        'Worktree is on'
      );
      expect(getSession(key)).toBe(agent);
      expect(isSessionAlive(key)).toBe(true);
      killSession(key);
    });
  }
);
