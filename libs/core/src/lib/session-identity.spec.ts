import { worktreeSessionKey, terminalSessionKey } from './session-key.js';
import { describe, expect, it } from 'vitest';
import type { TmuxSessionInfo } from '@n10/terminal-tmux';
import {
  isTerminalSession,
  isWorktreeSessionFor,
  registryNameOf,
  sanitizeLabelPart,
  sessionTags,
  taggedSession,
  terminalSessionLabel,
  worktreeSessionLabel,
} from './session-identity.js';

/**
 * Names are labels, tags are identity. The label builder is the half
 * of the convention both programs implement independently (Orchestra
 * in bash), so its outputs are pinned as literals — Orchestra pins the
 * same cases in `orchestra/tests/test_port.py` — rather than derived
 * from the function under test.
 */
describe('session labels', () => {
  // The cases Orchestra's test_port.py pins: repo, type, branch →
  // label. `/`, `.` and `:` become `-`; the repo's
  // basename keeps its case; on overflow the first 195 characters, `-`
  // and four hex digits of the SHA-256 of the *unsanitized*
  // `<basename>-<branch>`.
  it.each([
    ['/home/u/n10', 'worktree', 'feature/x', 'n10-feature-x'],
    [
      '/srv/agent-plugins',
      'worktree',
      'fix/typo.v1.2:rc',
      'agent-plugins-fix-typo-v1-2-rc',
    ],
    ['/x/my.repo', 'worktree', 'main', 'my-repo-main'],
    ['/home/u/n10', 'shell', '', 'n10-shell'],
    ['/home/u/n10', 'agent', '', 'n10-agent'],
    ['/x/r', 'worktree', 'a'.repeat(250), `r-${'a'.repeat(193)}-0a22`],
    // Same first 195 characters, different tails: only a hash over the
    // raw `<basename>-<branch>` tells `a/` from `a.` past the cut.
    ['/x/r', 'worktree', 'a/'.repeat(125), `r-${'a-'.repeat(96)}a-6e0f`],
    ['/x/r', 'worktree', 'a.'.repeat(125), `r-${'a-'.repeat(96)}a-b373`],
    // Terminal labels hash `<basename>-shell` / `<basename>-agent`.
    [`/x/${'b'.repeat(220)}`, 'shell', '', `${'b'.repeat(195)}-930d`],
    [`/x/${'b'.repeat(220)}`, 'agent', '', `${'b'.repeat(195)}-9fb6`],
    [
      '/x/agent-plugins',
      'worktree',
      'a'.repeat(250),
      `agent-plugins-${'a'.repeat(181)}-1fad`,
    ],
  ] as const)('%s %s %s → %s', (repo, type, branch, label) => {
    const built =
      type === 'worktree'
        ? worktreeSessionLabel(repo, branch)
        : terminalSessionLabel(repo, type);
    expect(built).toBe(label);
    expect(built.length).toBeLessThanOrEqual(200);
  });

  // The hash is over the raw string, before replacement: a branch that
  // differs only in a `/` versus a `-` past the cut must still get a
  // different tail, and a rule that hashed the replaced string would
  // give both the same one.
  it('hashes the unsanitized name on overflow', () => {
    const slashed = worktreeSessionLabel('/x/r', `${'a'.repeat(250)}/b`);
    const dashed = worktreeSessionLabel('/x/r', `${'a'.repeat(250)}-b`);
    expect(slashed.slice(0, 195)).toBe(dashed.slice(0, 195));
    expect(slashed).not.toBe(dashed);
  });

  it('sanitizes one part without capping it', () => {
    expect(sanitizeLabelPart('a/b.c:d')).toBe('a-b-c-d');
    expect(sanitizeLabelPart('x'.repeat(300))).toHaveLength(300);
  });
});

function listed(
  name: string,
  options: Record<string, string> | undefined,
  extra: Partial<TmuxSessionInfo> = {}
): TmuxSessionInfo {
  return { name, created: 10, path: '/p', paneDead: false, options, ...extra };
}

const OURS = {
  '@orchestra-spawner': 'n10',
  '@orchestra-repo': '/repos/alpha',
  '@orchestra-session-type': 'worktree',
  '@orchestra-branch': 'feat/a',
};

describe('taggedSession', () => {
  it('reads one of ours from its tags, never from its name', () => {
    expect(taggedSession(listed('anything-at-all', OURS))).toEqual({
      name: 'anything-at-all',
      created: 10,
      paneDead: false,
      path: '/p',
      spawner: 'n10',
      repo: '/repos/alpha',
      type: 'worktree',
      branch: 'feat/a',
      machine: 'local',
    });
  });

  // A session whose name is exactly what n10 would have chosen, but
  // that carries no tags, is foreign. Half the tags are not enough.
  it.each([
    ['no tags', undefined],
    ['empty tags', {}],
    ['spawner only', { '@orchestra-spawner': 'n10' }],
    [
      'worktree without repo',
      {
        '@orchestra-spawner': 'orchestra',
        '@orchestra-session-type': 'worktree',
        '@orchestra-branch': 'feat/a',
      },
    ],
    [
      'worktree with empty repo',
      {
        '@orchestra-spawner': 'n10',
        '@orchestra-session-type': 'worktree',
        '@orchestra-repo': '',
        '@orchestra-branch': 'feat/a',
      },
    ],
    ['session type only', { '@orchestra-session-type': 'worktree' }],
    [
      'an unknown session type',
      { '@orchestra-spawner': 'n10', '@orchestra-session-type': 'player' },
    ],
    [
      'repo and branch but no type',
      {
        '@orchestra-spawner': 'n10',
        '@orchestra-repo': '/repos/alpha',
        '@orchestra-branch': 'feat/a',
      },
    ],
  ])('treats a session with %s as foreign', (_label, options) => {
    expect(taggedSession(listed('n10-feat-a', options))).toBeNull();
  });

  it('carries the Orchestra tags along when set, and leaves them out when not', () => {
    const session = taggedSession(
      listed('x', {
        ...OURS,
        '@orchestra-spawner': 'orchestra',
        '@orchestra-agent': 'codex',
        '@orchestra-orchestrator': 'tmux:n10-main',
        '@orchestra-last-report': 'DONE 2026-09-14T10:22:03Z',
      })
    );
    expect(session).toMatchObject({
      spawner: 'orchestra',
      agent: 'codex',
      orchestrator: 'tmux:n10-main',
      lastReport: 'DONE 2026-09-14T10:22:03Z',
    });
    expect(taggedSession(listed('x', OURS))).not.toHaveProperty('agent');
  });
});

describe('matching', () => {
  const worktree = taggedSession(listed('n', OURS))!;
  const shell = taggedSession(
    listed('alpha-shell', {
      '@orchestra-spawner': 'n10',
      '@orchestra-repo': '/repos/alpha',
      '@orchestra-session-type': 'shell',
    })
  )!;

  it('matches a worktree session on repo and unsanitized branch, exactly', () => {
    expect(isWorktreeSessionFor(worktree, '/repos/alpha', 'feat/a')).toBe(true);
    expect(isWorktreeSessionFor(worktree, '/repos/alpha', 'feat-a')).toBe(
      false
    );
    expect(isWorktreeSessionFor(worktree, '/repos/alpha/', 'feat/a')).toBe(
      false
    );
    expect(isWorktreeSessionFor(worktree, '/repos/beta', 'feat/a')).toBe(false);
    expect(isWorktreeSessionFor(shell, '/repos/alpha', 'feat/a')).toBe(false);
  });

  it('tells a terminal tab from a worktree session by type', () => {
    expect(isTerminalSession(shell)).toBe(true);
    expect(isTerminalSession(worktree)).toBe(false);
  });

  // The registry keys a worktree session by the branch with `/`
  // rewritten, and a terminal by its tmux name.
  it('keys a session the way the PTY registry does', () => {
    expect(registryNameOf(worktree)).toBe(
      worktreeSessionKey('feat/a', '/repos/alpha')
    );
    expect(registryNameOf(shell)).toBe(terminalSessionKey('alpha-shell'));
  });
});

describe('sessionTags', () => {
  it('writes spawner, repo, type and — for a worktree — the unsanitized branch', () => {
    expect(
      sessionTags('/repos/alpha', { type: 'worktree', branch: 'feat/a' })
    ).toEqual(OURS);
    expect(sessionTags('/repos/alpha', { type: 'agent' })).toEqual({
      '@orchestra-spawner': 'n10',
      '@orchestra-repo': '/repos/alpha',
      '@orchestra-session-type': 'agent',
    });
  });

  it('round-trips through taggedSession', () => {
    const tags = sessionTags('/repos/alpha', { type: 'shell' });
    expect(taggedSession(listed('alpha-shell', tags))).toMatchObject({
      spawner: 'n10',
      repo: '/repos/alpha',
      type: 'shell',
    });
  });
});
