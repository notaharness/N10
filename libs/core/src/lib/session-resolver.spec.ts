import { worktreeSessionKey } from './session-key.js';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  listOurSessions,
  resolveRegistrySession,
  resolveSessionByName,
  resolveWorktreeSession,
} from './session-resolver.js';

/**
 * The resolver against a real tmux server — the scratch one
 * `vitest.setup.ts` pins through `TMUX_TMPDIR` with `$TMUX` dropped —
 * because what it promises is about tmux state: a session is found by
 * its tags whatever it is called, and a session with the right name and
 * no tags is not found at all. Skipped where tmux is not installed.
 */

function tmuxAvailable(): boolean {
  try {
    execFileSync('tmux', ['-V'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const SKIP = !tmuxAvailable();
const created: string[] = [];

/** Unique per run so parallel workers on one socket cannot collide. */
const RUN = `${process.pid}-${Date.now().toString(36)}`;
const name = (label: string) => `resolver-${RUN}-${label}`;
/** A checkout path per label; the path tag wins, so it need not exist. */
const wt = (label: string) => `/worktrees/${RUN}/${label}`;

function startSession(
  sessionName: string,
  tags: Record<string, string>,
  cwd = process.cwd()
): void {
  execFileSync('tmux', [
    'new-session',
    '-d',
    '-s',
    sessionName,
    '-c',
    cwd,
    '--',
    '/bin/sh',
    '-c',
    'sleep 30',
  ]);
  created.push(sessionName);
  for (const [key, value] of Object.entries(tags)) {
    execFileSync('tmux', ['set-option', '-t', `=${sessionName}:`, key, value]);
  }
}

function tags(
  type: 'worktree' | 'shell' | 'agent',
  repo: string,
  branch?: string,
  worktreePath = branch ? wt(branch) : undefined
): Record<string, string> {
  return {
    '@orchestra-spawner': 'n10',
    '@orchestra-repo': repo,
    '@orchestra-session-type': type,
    ...(branch ? { '@orchestra-branch': branch } : {}),
    ...(worktreePath ? { '@orchestra-worktree-path': worktreePath } : {}),
  };
}

beforeAll(() => {
  if (SKIP) return;
  if (
    process.env.TMUX ||
    !process.env.TMUX_TMPDIR?.includes('n10-core-tests-')
  ) {
    throw new Error(
      'refusing to run against a tmux socket that is not the scratch one'
    );
  }
});

afterEach(() => {
  while (created.length > 0) {
    const sessionName = created.pop()!;
    try {
      execFileSync('tmux', ['kill-session', '-t', `=${sessionName}:`], {
        stdio: 'ignore',
      });
    } catch {
      /* already gone */
    }
  }
});

describe.skipIf(SKIP)('session resolver', () => {
  const REPO = `/repos/alpha-${RUN}`;

  it('finds a worktree session by its tags, whatever it is called', () => {
    startSession(name('anything'), tags('worktree', REPO, 'feat/a'));
    expect(resolveWorktreeSession(REPO, wt('feat/a'))).toMatchObject({
      name: name('anything'),
      repo: REPO,
      branch: 'feat/a',
      worktreePath: wt('feat/a'),
      path: process.cwd(),
    });
  });

  // The name n10 would have chosen, on a session nobody tagged: not
  // ours. Neither the checkout lookup nor the registry-key lookup may
  // land on it.
  it('does not find an untagged session that carries the expected name', () => {
    startSession(`alpha-${RUN}-feat-a`, {});
    startSession(name('half'), { '@orchestra-spawner': 'n10' });
    expect(resolveWorktreeSession(REPO, process.cwd())).toBeNull();
    expect(resolveRegistrySession(REPO, `alpha-${RUN}-feat-a`)).toBeNull();
    expect(resolveSessionByName(`alpha-${RUN}-feat-a`)).toBeNull();
    expect(resolveSessionByName(name('half'))).toBeNull();
    expect(listOurSessions().map((s) => s.name)).not.toContain(
      `alpha-${RUN}-feat-a`
    );
  });

  it('matches the repo and the checkout exactly, never the branch', () => {
    startSession(name('a'), tags('worktree', REPO, 'feat/a'));
    expect(resolveWorktreeSession(REPO, 'feat/a')).toBeNull();
    expect(resolveWorktreeSession(REPO, wt('feat-a'))).toBeNull();
    expect(resolveWorktreeSession(`${REPO}/`, wt('feat/a'))).toBeNull();
    expect(resolveWorktreeSession('/repos/beta', wt('feat/a'))).toBeNull();
  });

  it('takes the oldest of several sessions claiming one identity, and lists the rest', async () => {
    startSession(name('first'), tags('worktree', REPO, 'dup'));
    // `session_created` has one-second resolution.
    await new Promise((r) => setTimeout(r, 1100));
    startSession(name('second'), tags('worktree', REPO, 'dup'));
    expect(resolveWorktreeSession(REPO, wt('dup'))?.name).toBe(name('first'));
    expect(
      listOurSessions()
        .filter((s) => s.branch === 'dup')
        .map((s) => s.name)
        .sort()
    ).toEqual([name('first'), name('second')].sort());
  });

  // A tmux name is unique on the server, so a caller that holds one —
  // a terminal tab, or an orphaned worktree session a tab adopted —
  // reaches exactly that session, whatever its type or repository.
  // Only the tags decide "ours".
  it('finds any of our sessions by exact name, whatever its type or repository', () => {
    startSession(name('shell'), tags('shell', '/repos/elsewhere'));
    startSession(name('agent'), tags('agent', REPO));
    startSession(name('wt'), tags('worktree', REPO, 'x'));
    startSession(name('theirs'), tags('worktree', '/repos/elsewhere', 'x'));
    expect(resolveSessionByName(name('shell'))).toMatchObject({
      type: 'shell',
      repo: '/repos/elsewhere',
    });
    expect(resolveSessionByName(name('agent'))?.type).toBe('agent');
    expect(resolveSessionByName(name('wt'))?.type).toBe('worktree');
    expect(resolveSessionByName(name('theirs'))?.repo).toBe('/repos/elsewhere');
    expect(resolveSessionByName(name('shell-2'))).toBeNull();
    expect(resolveSessionByName(name('shel'))).toBeNull();
  });

  // The listing must never ask for `@orchestra-undelivered` or
  // `@orchestra-launching`: the first carries newlines, which would split
  // a session across lines and shift every column after it. Pinned
  // against a real tmux, with such a value set.
  it('lists cleanly beside a session carrying a multi-line undelivered tag', () => {
    startSession(name('noisy'), {
      ...tags('worktree', REPO, 'noisy'),
      '@orchestra-launching': '1',
      '@orchestra-undelivered':
        '2026-09-14T10:00:00Z first line\n2026-09-14T10:01:00Z second line',
    });
    startSession(name('quiet'), tags('worktree', REPO, 'quiet'));
    const ours = listOurSessions().filter((s) => s.repo === REPO);
    expect(ours.map((s) => [s.name, s.branch, s.path]).sort()).toEqual(
      [
        [name('noisy'), 'noisy', process.cwd()],
        [name('quiet'), 'quiet', process.cwd()],
      ].sort()
    );
  });

  // The registry keys a worktree session by its checkout
  // (`worktreeSessionKey`), and a terminal by its name; a caller holding
  // only that key reaches the same session the tags describe.
  it('resolves a registry key to the worktree session whose checkout keys to it', () => {
    startSession(name('slashy'), tags('worktree', REPO, 'feat/b'));
    startSession(name('other-repo'), tags('worktree', '/repos/beta', 'feat/c'));
    expect(
      resolveRegistrySession(REPO, worktreeSessionKey(wt('feat/b'), REPO))?.name
    ).toBe(name('slashy'));
    expect(resolveRegistrySession(REPO, wt('feat/b'))).toBeNull();
    expect(
      resolveRegistrySession(REPO, worktreeSessionKey(wt('feat/c'), REPO))
    ).toBeNull();
  });

  // A registry key handed here names a checkout, and a session's own
  // name is never one: an agent labelled `feature-x` must not answer
  // for its label, and an agent tab must not answer for its name
  // either. Terminal tabs are reached by `resolveSessionByName`, never
  // through a key.
  it('resolves a registry key by checkout only, never to any session by name', () => {
    startSession(name('term'), tags('agent', REPO));
    startSession(name('feature-x'), tags('worktree', REPO, 'x'));
    expect(resolveRegistrySession(REPO, name('term'))).toBeNull();
    expect(resolveRegistrySession(REPO, name('feature-x'))).toBeNull();
    expect(
      resolveRegistrySession(REPO, worktreeSessionKey(wt('x'), REPO))?.name
    ).toBe(name('feature-x'));
  });
});

describe('session resolver without a server', () => {
  it('answers nothing rather than throwing', () => {
    expect(resolveWorktreeSession('/nowhere', 'x', [])).toBeNull();
    expect(resolveSessionByName('x', [])).toBeNull();
    expect(resolveRegistrySession('/nowhere', 'x', [])).toBeNull();
  });
});
