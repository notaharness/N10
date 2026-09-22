import { worktreeSessionKey } from '../session-key.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaggedSession } from '../session-identity.js';
import type { WorktreeHead } from './worktree-origin.js';

/**
 * Which live tmux sessions are worktree agents, and whose: the tags
 * are the record — repository and spawned-under branch — and the
 * worktree's HEAD file says whether it is still that branch. Nothing
 * here forks git, and a session with no tags is nobody's.
 */

const state = vi.hoisted(() => ({
  sessions: [] as TaggedSession[],
}));

vi.mock('@n10/worktree-manager', () => ({
  branchToSessionName: (branch: string) => branch.replace(/\//g, '-'),
}));
vi.mock('../session-resolver.js', () => ({
  listOurSessions: () => state.sessions,
}));

import { listLiveWorktreeSessions } from './live-worktree-sessions.js';

/** What each worktree directory's HEAD file says. */
const HEADS: Record<string, WorktreeHead> = {
  '/repos/alpha/.claude/worktrees/feat-a': {
    branch: 'feat/a',
    detached: false,
  },
  '/repos/beta/.claude/worktrees/feat-b': { branch: 'feat-b', detached: false },
  '/repos/beta/.claude/worktrees/hotfix': { branch: 'hotfix', detached: true },
};
const gone = new Set<string>();
const existsMock = (path: string) => path in HEADS && !gone.has(path);
const headMock = vi.fn((path: string): WorktreeHead | null =>
  existsMock(path) ? HEADS[path]! : null
);
const list = () =>
  listLiveWorktreeSessions({ exists: existsMock, readHead: headMock });

function session(
  name: string,
  path: string,
  repo: string,
  branch: string,
  extra: Partial<TaggedSession> = {}
): TaggedSession {
  return {
    name,
    created: 1,
    paneDead: false,
    path,
    spawner: 'n10',
    repo,
    type: 'worktree',
    branch,
    machine: 'local',
    ...extra,
  };
}

const ALPHA = session(
  'alpha-feat-a',
  '/repos/alpha/.claude/worktrees/feat-a',
  '/repos/alpha',
  'feat/a'
);
const BETA = session(
  'beta-feat-b',
  '/repos/beta/.claude/worktrees/feat-b',
  '/repos/beta',
  'feat-b'
);

beforeEach(() => {
  state.sessions = [];
  headMock.mockClear();
  gone.clear();
});

describe('listLiveWorktreeSessions', () => {
  it('ties every worktree agent to its repository and branch from its tags', () => {
    state.sessions = [ALPHA, BETA];
    expect(list()).toEqual([
      {
        tmuxName: 'alpha-feat-a',
        path: ALPHA.path,
        repoRoot: '/repos/alpha',
        branch: 'feat/a',
        detached: false,
        sessionName: worktreeSessionKey('feat/a', '/repos/alpha'),
        machine: 'local',
      },
      {
        tmuxName: 'beta-feat-b',
        path: BETA.path,
        repoRoot: '/repos/beta',
        branch: 'feat-b',
        detached: false,
        sessionName: worktreeSessionKey('feat-b', '/repos/beta'),
        machine: 'local',
      },
    ]);
  });

  it('stamps the sessionName and machine from the session that was listed, for a local session', () => {
    state.sessions = [ALPHA];
    expect(list()).toEqual([
      expect.objectContaining({
        machine: 'local',
        sessionName: worktreeSessionKey('feat/a', '/repos/alpha'),
      }),
    ]);
  });

  // Finding 11: `exists`/`readHead` read *this* machine's filesystem,
  // synchronously — meaningless for a session whose own tag says it
  // lives elsewhere. A remote session's path happening to also exist
  // locally (as ALPHA's does here) must not make it eligible: refusing
  // loudly beats reading the wrong filesystem. Once this can honour
  // the machine (an async stat/HEAD read through its own executor)
  // this test should change to expect it included instead.
  it('excludes a session tagged for a remote machine rather than reading its path locally', () => {
    state.sessions = [{ ...ALPHA, machine: 'peer-123' }];
    expect(list()).toEqual([]);
    expect(headMock).not.toHaveBeenCalled();
  });

  // The repository is the tag's to say: the name is not consulted, and
  // a session created under any label is filed where its tag says.
  it('takes the repository from the tag, not from the name', () => {
    state.sessions = [{ ...ALPHA, name: 'beta-feat-a-2' }];
    expect(list()[0]).toMatchObject({
      tmuxName: 'beta-feat-a-2',
      repoRoot: '/repos/alpha',
    });
  });

  // A detached-HEAD worktree is named after its directory, and the
  // listing says so: which shells can attach to one is their rule.
  it('reports a detached HEAD as such, under the directory name', () => {
    state.sessions = [
      session(
        'beta-hotfix',
        '/repos/beta/.claude/worktrees/hotfix',
        '/repos/beta',
        'hotfix'
      ),
    ];
    expect(list()).toEqual([
      expect.objectContaining({ branch: 'hotfix', detached: true }),
    ]);
  });

  it('leaves out terminal tabs and sessions with no path', () => {
    state.sessions = [
      session('alpha-shell', '/repos/alpha', '/repos/alpha', '', {
        type: 'shell',
      }),
      session('alpha-agent', '/repos/alpha', '/repos/alpha', '', {
        type: 'agent',
      }),
      { ...ALPHA, path: '' },
    ];
    expect(list()).toEqual([]);
  });

  it('leaves out a session whose directory is gone or has no HEAD', () => {
    state.sessions = [
      ALPHA,
      session('alpha-old', '/gone', '/repos/alpha', 'old'),
    ];
    gone.add(ALPHA.path);
    expect(list()).toEqual([]);
  });

  // The tag says what the session was spawned under; HEAD says what
  // the worktree is on now. When they differ the agent checked out
  // another branch mid-session — the orphan case, which the
  // repository's own scanner reports as a terminal — and nobody's to
  // list here.
  it('leaves out a session whose worktree has moved to another branch', () => {
    state.sessions = [ALPHA];
    headMock.mockReturnValueOnce({ branch: 'other/branch', detached: false });
    expect(list()).toEqual([]);
  });

  it('matches the tagged branch exactly, unsanitized', () => {
    state.sessions = [{ ...ALPHA, branch: 'feat-a' }];
    expect(list()).toEqual([]);
  });

  it('passes the Orchestra tags along when set', () => {
    state.sessions = [
      {
        ...ALPHA,
        spawner: 'orchestra',
        agent: 'codex',
        orchestrator: 'tmux:alpha-main',
        lastReport: 'DONE 2026-09-14T10:22:03Z',
      },
    ];
    expect(list()).toEqual([
      expect.objectContaining({
        agent: 'codex',
        orchestrator: 'tmux:alpha-main',
        lastReport: 'DONE 2026-09-14T10:22:03Z',
      }),
    ]);
    state.sessions = [ALPHA];
    expect(list()[0]).not.toHaveProperty('agent');
  });

  it('leaves out a retained pane whose agent exited', () => {
    state.sessions = [{ ...ALPHA, paneDead: true }];
    expect(list()).toEqual([]);
  });
});
