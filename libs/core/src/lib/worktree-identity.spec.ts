import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TmuxSessionInfo } from '@n10/terminal-tmux';

/**
 * A worktree session belongs to its checkout, not to the branch it was
 * created for: `git switch`, a branch rename or a restart leave it the
 * checkout's, a second worktree on its original branch never claims
 * it. The `@orchestra-worktree-path` tag is the association, over
 * tmux's own `session_path` and never falling back to the branch; a
 * worktree session without it is foreign.
 */

const { listMock, execFileSyncMock, liveNamesMock, entries } = vi.hoisted(
  () => ({
    listMock: vi.fn<() => TmuxSessionInfo[]>(),
    execFileSyncMock: vi.fn(),
    liveNamesMock: vi.fn<() => string[]>(),
    entries: new Map<string, { createdFor?: string }>(),
  })
);

vi.mock('node:child_process', () => ({
  execFileSync: (...args: unknown[]) => execFileSyncMock(...args),
}));
vi.mock('@n10/terminal-tmux', () => ({
  isTmuxAvailable: vi.fn(),
  tmuxKillSession: vi.fn(),
  tmuxListSessionsDetailed: () => listMock(),
}));
vi.mock('@n10/worktree-manager', () => ({ listWorktrees: vi.fn() }));
vi.mock('./pty-registry.js', () => ({
  liveSessionNames: () => liveNamesMock(),
  getSession: (name: string) => entries.get(name),
}));

import { observeTmuxSessions, resetRepoRoot } from './session-backend.js';
import { resolveWorktreeSession } from './session-resolver.js';
import { taggedSession } from './session-identity.js';
import {
  keyForWorktree,
  resolveRemoteWorktreePath,
  worktreeSessionKey,
} from './session-key.js';
import { worktreeSessionRow } from './worktree-rows.js';

const REPO = '/repo';
const WT = '/repo/.claude/worktrees/feature';
const WT2 = '/repo/.claude/worktrees/feature-again';

function session(
  opts: { branch: string; path: string; tag?: string; created?: number },
  name = `repo-${opts.branch}`
): TmuxSessionInfo {
  return {
    name,
    created: opts.created ?? 1,
    paneDead: false,
    path: opts.path,
    options: {
      '@orchestra-spawner': 'orchestra',
      '@orchestra-repo': REPO,
      '@orchestra-session-type': 'worktree',
      '@orchestra-branch': opts.branch,
      ...(opts.tag ? { '@orchestra-worktree-path': opts.tag } : {}),
    },
  };
}

const worktree = (path: string, branch: string) => ({
  name: keyForWorktree({ path }, REPO),
  branch,
  path,
});

beforeEach(() => {
  resetRepoRoot();
  execFileSyncMock.mockReset();
  execFileSyncMock.mockReturnValue(`${REPO}\n`);
  listMock.mockReset();
  liveNamesMock.mockReset();
  liveNamesMock.mockReturnValue([]);
  entries.clear();
});

describe('discovery matches a session to its checkout', () => {
  it('keeps a switched worktree’s session its own', () => {
    listMock.mockReturnValue([
      session({ branch: 'feature', path: WT, tag: WT }),
    ]);
    const seen = observeTmuxSessions([worktree(WT, 'other')]);
    expect([...seen.persisted]).toEqual([keyForWorktree({ path: WT }, REPO)]);
    expect(seen.terminals).toEqual([]);
  });

  it('does not hand the session to a second worktree on its original branch', () => {
    listMock.mockReturnValue([
      session({ branch: 'feature', path: WT, tag: WT }),
    ]);
    const seen = observeTmuxSessions([
      worktree(WT, 'other'),
      worktree(WT2, 'feature'),
    ]);
    expect([...seen.persisted]).toEqual([keyForWorktree({ path: WT }, REPO)]);
  });

  it('treats a worktree session without the tag as foreign', () => {
    listMock.mockReturnValue([session({ branch: 'feature', path: WT })]);
    const seen = observeTmuxSessions([worktree(WT, 'feature')]);
    expect(seen.persisted.size).toBe(0);
    expect(seen.terminals).toEqual([]);
  });

  it('trusts the tag over a session_path that has since changed', () => {
    listMock.mockReturnValue([
      session({ branch: 'feature', path: '/somewhere/else', tag: WT }),
    ]);
    const seen = observeTmuxSessions([worktree(WT, 'feature')]);
    expect([...seen.persisted]).toEqual([keyForWorktree({ path: WT }, REPO)]);
  });

  it('never falls back to the branch when the tag names a checkout that is gone', () => {
    listMock.mockReturnValue([
      session({
        branch: 'feature',
        path: WT2,
        tag: '/repo/.claude/worktrees/gone',
      }),
    ]);
    const seen = observeTmuxSessions([worktree(WT2, 'feature')]);
    expect(seen.persisted.size).toBe(0);
    // Surfaced where it runs instead, as an orphan agent.
    expect(seen.terminals).toEqual([
      expect.objectContaining({ kind: 'agent', path: WT2 }),
    ]);
  });
});

describe('resolving a checkout’s session', () => {
  const tagged = (info: TmuxSessionInfo) => taggedSession(info)!;

  it('finds it whichever branch it was created for', () => {
    const s = tagged(session({ branch: 'feature', path: WT, tag: WT }));
    expect(resolveWorktreeSession(REPO, WT, [s])).toBe(s);
    expect(resolveWorktreeSession(REPO, WT2, [s])).toBeNull();
  });

  it('reads the tag, never the session_path, and nothing for a terminal', () => {
    expect(
      tagged(session({ branch: 'b', path: '/p', tag: WT })).worktreePath
    ).toBe(WT);
    expect(taggedSession(session({ branch: 'b', path: WT }))).toBeNull();
    const terminal = session({ branch: 'b', path: WT });
    terminal.options!['@orchestra-session-type'] = 'shell';
    expect(tagged(terminal).worktreePath).toBe('');
  });
});

describe('the key is the canonical checkout', () => {
  const dir = mkdtempSync(join(tmpdir(), 'n10-worktree-identity-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('is the same through a symlink', () => {
    const real = join(dir, 'real');
    mkdirSync(real);
    symlinkSync(real, join(dir, 'link'));
    expect(worktreeSessionKey(join(dir, 'link'), REPO)).toBe(
      worktreeSessionKey(real, REPO)
    );
  });

  it('keeps another machine’s path as that machine reported it', () => {
    expect(worktreeSessionKey('/their/wt', REPO, 'peer')).toBe(
      JSON.stringify(['worktree', REPO, '/their/wt', 'peer'])
    );
  });
});

describe('worktreeSessionRow', () => {
  const name = worktreeSessionKey(WT, REPO);

  it('keys the row by checkout and says which branch its agent was created for', () => {
    entries.set(name, { createdFor: 'feature' });
    expect(
      worktreeSessionRow({ branch: 'other', path: WT }, () => true, REPO)
    ).toEqual({
      name,
      label: 'other',
      branch: 'other',
      path: WT,
      running: true,
      sessionBranch: 'feature',
    });
  });

  it('says nothing while the checkout is on that branch, or has no agent', () => {
    entries.set(name, { createdFor: 'feature' });
    const row = (branch: string, path = WT) =>
      worktreeSessionRow({ branch, path }, () => false, REPO);
    expect(row('feature')).not.toHaveProperty('sessionBranch');
    expect(row('feature', WT2)).not.toHaveProperty('sessionBranch');
  });
});

describe('a scan notices a worktree that switched branch', () => {
  it('reports it under its unchanged key, and as a change', async () => {
    const { diffScans } = await import('./discovery/discovery-model.js');
    const scan = (branch: string) => ({
      worktrees: [worktree(WT, branch)],
      persisted: new Set<string>(),
      terminals: [],
    });
    const delta = diffScans(scan('feature'), scan('other'), () => false);
    expect(delta.switched).toEqual([worktree(WT, 'other')]);
    expect(delta.appeared).toEqual([]);
    expect(delta.disappeared).toEqual([]);
    expect(delta.changed).toBe(true);
    expect(diffScans(scan('other'), scan('other'), () => false).changed).toBe(
      false
    );
  });
});

describe('another machine’s checkout', () => {
  const executor = (result: { stdout: string; code: number } | Error) => ({
    run: vi.fn(async (argv: string[], opts?: { cwd?: string }) => {
      if (result instanceof Error) throw result;
      expect({ argv, cwd: opts?.cwd }).toEqual({
        argv: ['pwd', '-P'],
        cwd: '/their/link/wt',
      });
      return { ...result, stderr: '' };
    }),
  });

  it('is resolved to its physical path on that machine', async () => {
    await expect(
      resolveRemoteWorktreePath(
        '/their/link/wt',
        executor({ stdout: '/their/real/wt\n', code: 0 })
      )
    ).resolves.toBe('/their/real/wt');
  });

  it('keeps the path as given when that machine cannot resolve it', async () => {
    await expect(
      resolveRemoteWorktreePath(
        '/their/link/wt',
        executor({ stdout: '', code: 1 })
      )
    ).resolves.toBe('/their/link/wt');
    await expect(
      resolveRemoteWorktreePath('/their/link/wt', executor(new Error('gone')))
    ).resolves.toBe('/their/link/wt');
  });
});
