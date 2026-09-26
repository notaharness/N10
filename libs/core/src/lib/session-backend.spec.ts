import { worktreeSessionKey, terminalSessionKey } from './session-key.js';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TmuxSessionInfo, TmuxStatus } from '@n10/terminal-tmux';
import type { DiscoveredWorktree } from './discovery/discovery-model.js';

const {
  isTmuxAvailableMock,
  tmuxKillSessionMock,
  tmuxListSessionsMock,
  execFileSyncMock,
  liveSessionNamesMock,
} = vi.hoisted(() => {
  return {
    isTmuxAvailableMock: vi.fn<() => Promise<TmuxStatus>>(),
    tmuxKillSessionMock: vi.fn<(name: string) => void>(),
    tmuxListSessionsMock: vi.fn<() => TmuxSessionInfo[]>(),
    execFileSyncMock: vi.fn(),
    // Stands in for the PTY registry's own bookkeeping: which bare
    // session names this process currently holds alive, independent of
    // whatever the worktree list or tmux happen to report this scan.
    liveSessionNamesMock: vi.fn<() => string[]>(),
  };
});

vi.mock('node:child_process', () => ({
  execFileSync: (...args: unknown[]) => execFileSyncMock(...args),
}));

vi.mock('@n10/terminal-tmux', () => ({
  isTmuxAvailable: () => isTmuxAvailableMock(),
  tmuxKillSession: (name: string) => tmuxKillSessionMock(name),
  tmuxListSessionsDetailed: () => tmuxListSessionsMock(),
}));
vi.mock('@n10/worktree-manager', () => ({
  branchToSessionName: (branch: string) => branch.replace(/\//g, '-'),
}));
vi.mock('./pty-registry.js', () => ({
  liveSessionNames: () => liveSessionNamesMock(),
}));
import {
  applySessionBackend,
  getRepoRoot,
  hasLiveTmuxSession,
  hasPersistedTerminalSession,
  killPersistedTmuxSession,
  observeTmuxSessions,
  probeTmuxAvailability,
  resetRepoRoot,
} from './session-backend.js';

const TMUX_MISSING: TmuxStatus = {
  available: false,
  reason: 'tmux binary not found on PATH',
  installHint: 'brew install tmux',
};

/** One of our sessions as the listing reports it: the name is any
 *  label, the identity is in the options. */
function ours(
  name: string,
  type: 'worktree' | 'shell' | 'agent',
  repo: string,
  branch: string | null,
  path: string,
  created = 1
): TmuxSessionInfo {
  return {
    name,
    created,
    paneDead: false,
    path,
    options: {
      '@orchestra-spawner': 'n10',
      '@orchestra-repo': repo,
      '@orchestra-session-type': type,
      ...(branch === null ? {} : { '@orchestra-branch': branch }),
    },
  };
}

/** A session nobody tagged — however it is named. */
function foreign(name: string, path = '/x'): TmuxSessionInfo {
  return { name, created: 1, paneDead: false, path, options: {} };
}

/** A worktree checkout's directory under `/repo`. */
const dirOf = (dir: string) => `/repo/.claude/worktrees/${dir}`;

function wt(name: string, branch: string, dir = name): DiscoveredWorktree {
  return {
    name: worktreeSessionKey(dirOf(dir)),
    branch,
    path: dirOf(dir),
  };
}

beforeEach(async () => {
  isTmuxAvailableMock.mockReset();
  tmuxKillSessionMock.mockReset();
  tmuxListSessionsMock.mockReset();
  tmuxListSessionsMock.mockReturnValue([]);
  liveSessionNamesMock.mockReset();
  liveSessionNamesMock.mockReturnValue([]);
  // getRepoRoot memoizes for the process, so a test that let it resolve
  // to null would decide every later one. Reset and let it find /repo.
  resetRepoRoot();
  execFileSyncMock.mockReset();
  execFileSyncMock.mockReturnValue('/repo\n');
  // Each test starts with a usable tmux probe.
  isTmuxAvailableMock.mockResolvedValueOnce({
    available: true,
    version: '3.4',
  });
  await probeTmuxAvailability();
  isTmuxAvailableMock.mockReset();
});

describe('tmux requirement', () => {
  it('accepts a successful startup probe', () => {
    expect(() => applySessionBackend()).not.toThrow();
  });

  it('rejects unavailable tmux with an installation hint', async () => {
    isTmuxAvailableMock.mockResolvedValueOnce(TMUX_MISSING);
    await probeTmuxAvailability();
    expect(() => applySessionBackend()).toThrow(
      /requires tmux.*brew install tmux/
    );
  });
});

describe('getRepoRoot', () => {
  // One test rather than two: getRepoRoot memoizes, so a second test
  // would read the cache and never re-invoke execFileSync.
  it('returns null outside a git working tree, without throwing', () => {
    execFileSyncMock.mockImplementation(() => {
      throw new Error('fatal: not a git repository');
    });

    // Runs inside a useEffect — a throw here would take the render down
    // rather than surfacing as a recoverable error.
    expect(getRepoRoot()).toBeNull();

    // stderr is swallowed, not inherited: git's "fatal:" line written
    // straight to the terminal would land mid-frame and corrupt Ink's
    // render.
    expect(execFileSyncMock).toHaveBeenCalledWith(
      'git',
      ['rev-parse', '--show-toplevel'],
      expect.objectContaining({ stdio: ['ignore', 'pipe', 'ignore'] })
    );

    // Memoized, including the failure — no repeated forks per render.
    expect(getRepoRoot()).toBeNull();
    expect(execFileSyncMock).toHaveBeenCalledTimes(1);
  });
});

/**
 * A registry name reaches a tmux session through its tags: a worktree
 * session whose tagged checkout keys to the name, or a terminal tab
 * called exactly that. The name a session happens to carry is never
 * the answer — and a session that carries the right name with no tags
 * is somebody else's.
 */
describe('tmux session existence', () => {
  it('sees a live session by its tags, whatever it is called, independently of its label', () => {
    tmuxListSessionsMock.mockReturnValue([
      ours('some-label-2', 'worktree', '/repo', 'feature/x', '/wt/x'),
    ]);
    expect(hasLiveTmuxSession(worktreeSessionKey('/wt/x'))).toBe(true);
    expect(hasLiveTmuxSession(worktreeSessionKey('/wt/y'))).toBe(false);
  });

  // An orphaned worktree session adopted as an agent terminal is keyed
  // by its tmux name from then on, and keeps its `worktree` tag. A
  // terminal tab is process-global and outlives a repository switch, so
  // the name lookup answers whatever repository is open now.
  it('sees an adopted orphan by its tmux name while another repository is open', () => {
    resetRepoRoot();
    execFileSyncMock.mockReturnValue('/repo-b\n');
    tmuxListSessionsMock.mockReturnValue([
      ours('repo-a-old', 'worktree', '/repo-a', 'old/branch', '/wt/dir'),
    ]);
    expect(hasPersistedTerminalSession(terminalSessionKey('repo-a-old'))).toBe(
      true
    );
    expect(hasPersistedTerminalSession(terminalSessionKey('repo-a-old'))).toBe(
      true
    );
    expect(
      hasPersistedTerminalSession(terminalSessionKey('repo-a-old-2'))
    ).toBe(false);
  });

  it('never sees an untagged session by name', () => {
    tmuxListSessionsMock.mockReturnValue([foreign('repo-shell')]);
    expect(hasPersistedTerminalSession(terminalSessionKey('repo-shell'))).toBe(
      false
    );
  });

  it('does not see an untagged session that carries the expected name', () => {
    tmuxListSessionsMock.mockReturnValue([foreign('repo-feature-x')]);
    expect(hasLiveTmuxSession(worktreeSessionKey('/x'))).toBe(false);
    expect(hasLiveTmuxSession(worktreeSessionKey('repo-feature-x'))).toBe(
      false
    );
  });

  it('does not see another repository’s session for the same checkout', () => {
    tmuxListSessionsMock.mockReturnValue([
      ours('other-feature-x', 'worktree', '/other', 'feature-x', '/wt/x'),
    ]);
    expect(hasLiveTmuxSession(worktreeSessionKey('/wt/x'))).toBe(false);
  });

  it('reports no live session when tmux is unavailable', async () => {
    isTmuxAvailableMock.mockResolvedValueOnce(TMUX_MISSING);
    await probeTmuxAvailability();
    tmuxListSessionsMock.mockReturnValue([
      ours('x', 'worktree', '/repo', 'feature-x', '/wt/x'),
    ]);
    expect(hasLiveTmuxSession(worktreeSessionKey('/wt/x'))).toBe(false);
    expect(tmuxListSessionsMock).not.toHaveBeenCalled();
  });

  // A registry key names a checkout, never a tmux name: repository
  // `/w/feature` with an agent on branch `x` is labelled `feature-x`,
  // and a key whose path segment happens to read `feature-x` must not
  // reach it by that label — only its own checkout's key does.
  it('never resolves a registry key to a worktree session by name', () => {
    resetRepoRoot();
    execFileSyncMock.mockReturnValue('/w/feature\n');
    tmuxListSessionsMock.mockReturnValue([
      ours('feature-x', 'worktree', '/w/feature', 'x', '/w/feature/wt/x'),
    ]);
    expect(hasLiveTmuxSession(worktreeSessionKey('feature-x'))).toBe(false);
    killPersistedTmuxSession(worktreeSessionKey('feature-x'));
    expect(tmuxKillSessionMock).not.toHaveBeenCalled();
    expect(hasLiveTmuxSession(worktreeSessionKey('/w/feature/wt/x'))).toBe(
      true
    );
  });

  // Kill the target verified by tags, not a label composed from the branch.
  it('kills the tagged session for a registry name, by the name tmux holds it under', () => {
    tmuxListSessionsMock.mockReturnValue([
      ours('repo-feature-x-3', 'worktree', '/repo', 'feature/x', '/wt/x'),
    ]);
    killPersistedTmuxSession(worktreeSessionKey('/wt/x'));
    expect(tmuxKillSessionMock).toHaveBeenCalledWith('repo-feature-x-3');
  });

  it('refuses to kill an untagged session, even one carrying the expected name', () => {
    tmuxListSessionsMock.mockReturnValue([
      foreign('repo-feature-x'),
      foreign('feature-x'),
    ]);
    killPersistedTmuxSession(worktreeSessionKey('/x'));
    killPersistedTmuxSession(worktreeSessionKey('repo-feature-x'));
    expect(tmuxKillSessionMock).not.toHaveBeenCalled();
  });

  it('refuses to kill another repository’s session', () => {
    tmuxListSessionsMock.mockReturnValue([
      ours('feature-x', 'worktree', '/other', 'feature-x', '/wt/x'),
    ]);
    killPersistedTmuxSession(worktreeSessionKey('/wt/x'));
    expect(tmuxKillSessionMock).not.toHaveBeenCalled();
  });

  it('does not throw when there is no server or session', () => {
    tmuxListSessionsMock.mockImplementation(() => {
      throw new Error('no server running');
    });
    expect(() =>
      killPersistedTmuxSession(worktreeSessionKey('/wt/x'))
    ).not.toThrow();
    expect(hasLiveTmuxSession(worktreeSessionKey('/wt/x'))).toBe(false);
  });

  it('is empty outside a git working tree', () => {
    resetRepoRoot();
    execFileSyncMock.mockImplementation(() => {
      throw new Error('fatal: not a git repository');
    });
    tmuxListSessionsMock.mockReturnValue([
      ours('x', 'worktree', '/repo', 'feature-x', '/wt/x'),
    ]);
    expect(hasLiveTmuxSession(worktreeSessionKey('/wt/x'))).toBe(false);
    killPersistedTmuxSession(worktreeSessionKey('/wt/x'));
    expect(tmuxKillSessionMock).not.toHaveBeenCalled();
  });
});

describe('terminal tabs reach tmux by their own name', () => {
  it('sees a terminal tab by name and type, from any repository', () => {
    tmuxListSessionsMock.mockReturnValue([
      ours('notes-shell', 'shell', '/elsewhere', null, '/home/dev/notes'),
    ]);
    expect(hasPersistedTerminalSession(terminalSessionKey('notes-shell'))).toBe(
      true
    );
    expect(
      hasPersistedTerminalSession(terminalSessionKey('notes-shell-2'))
    ).toBe(false);
    // A registry *key* never reaches a terminal tab, even one keyed by
    // the tab's own directory: keys are worktree checkouts.
    expect(hasLiveTmuxSession(worktreeSessionKey('/home/dev/notes'))).toBe(
      false
    );
  });

  // An agent tab runs in a directory a worktree key could name: the
  // user's agent tab in `/w/app` sits exactly where a key for checkout
  // `/w/app` points. The tab must not answer for that key — and must
  // not be killed in place of a worktree session.
  it('never kills an agent tab whose directory a worktree key names', () => {
    resetRepoRoot();
    execFileSyncMock.mockReturnValue('/w/app\n');
    tmuxListSessionsMock.mockReturnValue([
      ours('app-agent', 'agent', '/w/app', null, '/w/app'),
    ]);
    expect(hasLiveTmuxSession(worktreeSessionKey('/w/app'))).toBe(false);
    killPersistedTmuxSession(worktreeSessionKey('/w/app'));
    expect(tmuxKillSessionMock).not.toHaveBeenCalled();
    // The tab itself is still reachable by name.
    expect(hasPersistedTerminalSession(terminalSessionKey('app-agent'))).toBe(
      true
    );
  });

  // A tab is closed through its own registry entry, whose backend
  // holds the name tmux created. The key path reaches neither it nor a
  // stranger of that name, so nothing here is killed by either route.
  it('a registry key kills neither a terminal tab nor a foreign session of that name', () => {
    tmuxListSessionsMock.mockReturnValue([
      ours('repo-shell', 'shell', '/repo', null, '/repo'),
      foreign('repo-shell-2'),
    ]);
    killPersistedTmuxSession(worktreeSessionKey('/repo'));
    killPersistedTmuxSession(worktreeSessionKey('/x'));
    expect(tmuxKillSessionMock).not.toHaveBeenCalled();
    expect(hasPersistedTerminalSession(terminalSessionKey('repo-shell'))).toBe(
      true
    );
    expect(
      hasPersistedTerminalSession(terminalSessionKey('repo-shell-2'))
    ).toBe(false);
  });
});

/**
 * One listing, read through the tags: which worktrees have a session,
 * which terminal tabs exist, and which worktree sessions are orphans.
 */
describe('observeTmuxSessions', () => {
  it('reports a worktree as persisted when a session is tagged with its repo and checkout', () => {
    tmuxListSessionsMock.mockReturnValue([
      ours('whatever', 'worktree', '/repo', 'feat/a', dirOf('feat-a')),
      ours('repo-feat-b', 'worktree', '/repo', 'feat-b', dirOf('feat-b')),
    ]);
    const seen = observeTmuxSessions([
      wt('feat-a', 'feat/a'),
      wt('feat-b', 'feat-b'),
      wt('gone', 'gone'),
    ]);
    expect(seen.persisted).toEqual(
      new Set([
        worktreeSessionKey(dirOf('feat-a')),
        worktreeSessionKey(dirOf('feat-b')),
      ])
    );
    expect(seen.terminals).toEqual([]);
  });

  // A session named exactly what n10 would have chosen, with no
  // tags, is foreign: neither a persisted worktree nor a terminal.
  it('ignores an untagged session whatever it is called', () => {
    tmuxListSessionsMock.mockReturnValue([
      foreign('repo-feat-a', dirOf('feat-a')),
      foreign('repo-shell', '/repo'),
    ]);
    expect(observeTmuxSessions([wt('feat-a', 'feat-a')])).toEqual({
      persisted: new Set(),
      terminals: [],
    });
  });

  it('ignores another repository’s worktree sessions', () => {
    tmuxListSessionsMock.mockReturnValue([
      ours('feat-a', 'worktree', '/other', 'feat-a', '/other/wt/feat-a'),
    ]);
    expect(observeTmuxSessions([wt('feat-a', 'feat-a')])).toEqual({
      persisted: new Set(),
      terminals: [],
    });
  });

  // A detached-HEAD worktree has no branch; its session is tagged with
  // the directory's name, but it is matched by its checkout like any
  // other.
  it('matches a detached worktree by its checkout', () => {
    tmuxListSessionsMock.mockReturnValue([
      ours('repo-hotfix', 'worktree', '/repo', 'hotfix-dir', dirOf('hotfix')),
    ]);
    const seen = observeTmuxSessions([wt('hotfix', '')]);
    expect(seen.persisted).toEqual(
      new Set([worktreeSessionKey(dirOf('hotfix'))])
    );
  });

  // Terminals belong to a directory, not to the repository the scan
  // runs for: one started in another checkout, or in no checkout at
  // all, is still this user's terminal and must reopen. The kind is
  // the tag, not anything about the name.
  it('reports every terminal session by its session type, with its directory, wherever it runs', () => {
    tmuxListSessionsMock.mockReturnValue([
      ours('notes-shell', 'shell', '/elsewhere', null, '/home/dev/notes'),
      ours('repo-agent-2', 'agent', '/repo', null, '/repo'),
      ours('odd-name', 'shell', '/repo', null, '/repo'),
    ]);
    expect(observeTmuxSessions([]).terminals).toEqual([
      {
        name: terminalSessionKey('notes-shell'),
        kind: 'shell',
        running: true,
        path: '/home/dev/notes',
      },
      {
        name: terminalSessionKey('repo-agent-2'),
        kind: 'agent',
        running: true,
        path: '/repo',
      },
      {
        name: terminalSessionKey('odd-name'),
        kind: 'shell',
        path: '/repo',
        running: true,
      },
    ]);
  });

  // An agent that checks out another branch inside its worktree leaves
  // a session tagged with the old branch; it is still its checkout's,
  // and persisted there. A session whose checkout no worktree answers
  // to is the orphan — even when a worktree is on the branch it was
  // tagged with — and surfaces as an agent terminal in its directory
  // rather than vanishing, since the session is still running.
  it('keeps a switched worktree’s session and surfaces one whose checkout is gone as an agent terminal', () => {
    tmuxListSessionsMock.mockReturnValue([
      ours('repo-old-branch', 'worktree', '/repo', 'old-branch', dirOf('dir')),
      ours('repo-stray', 'worktree', '/repo', 'new-branch', '/wt/gone'),
    ]);
    const seen = observeTmuxSessions([wt('new-branch', 'new-branch', 'dir')]);
    expect(seen.persisted).toEqual(new Set([worktreeSessionKey(dirOf('dir'))]));
    expect(seen.terminals).toEqual([
      {
        name: terminalSessionKey('repo-stray'),
        kind: 'agent',
        running: true,
        path: '/wt/gone',
      },
    ]);
  });

  // A session whose checkout no worktree answers to may still be one
  // this process is driving. Reporting it as an orphan is how
  // `adoptTerminal` attaches a second client to a session already live
  // behind another tab, so it must never be offered while the registry
  // still holds it.
  it('never reports a session this process already holds as an orphan terminal', () => {
    liveSessionNamesMock.mockReturnValue([worktreeSessionKey('/wt/dir')]);
    tmuxListSessionsMock.mockReturnValue([
      ours('repo-old-branch', 'worktree', '/repo', 'old/branch', '/wt/dir'),
    ]);
    const seen = observeTmuxSessions([wt('new-branch', 'new-branch', 'dir')]);
    expect(seen.terminals).toEqual([]);
  });

  it('does not advertise an exited worktree as a running agent', () => {
    tmuxListSessionsMock.mockReturnValue([
      {
        ...ours('repo-done', 'worktree', '/repo', 'done', dirOf('done')),
        paneDead: true,
      },
    ]);
    expect(observeTmuxSessions([wt('done', 'done')])).toEqual({
      persisted: new Set(),
      terminals: [],
    });
  });

  it('retains exited terminal metadata for restoration', () => {
    const session = ours('repo-agent', 'agent', '/repo', null, '/repo');
    session.paneDead = true;
    session.options!['@orchestra-agent'] = 'codex';
    tmuxListSessionsMock.mockReturnValue([session]);
    expect(observeTmuxSessions([]).terminals).toEqual([
      {
        name: terminalSessionKey('repo-agent'),
        kind: 'agent',
        path: '/repo',
        running: false,
        agent: 'codex',
      },
    ]);
  });

  it('costs one fork for both answers', () => {
    observeTmuxSessions([wt('a', 'a'), wt('b', 'b')]);
    expect(tmuxListSessionsMock).toHaveBeenCalledTimes(1);
  });

  // tmux-cli hands back '' for a list-sessions line it could not split
  // on a tab, not a real directory. A terminal tab needs somewhere to
  // run and display, so a pathless line must be dropped rather than
  // opening a tab onto nothing — for a terminal and for an orphaned
  // worktree session alike.
  it('drops a session with no reported path', () => {
    tmuxListSessionsMock.mockReturnValue([
      ours('repo-shell', 'shell', '/repo', null, ''),
      ours('repo-old', 'worktree', '/repo', 'old', ''),
    ]);
    expect(observeTmuxSessions([]).terminals).toEqual([]);
  });

  it('is empty outside a git working tree', () => {
    resetRepoRoot();
    execFileSyncMock.mockImplementation(() => {
      throw new Error('fatal: not a git repository');
    });
    tmuxListSessionsMock.mockReturnValue([
      ours('x', 'worktree', '/repo', 'feat-a', '/wt/feat-a'),
    ]);
    expect(observeTmuxSessions([wt('feat-a', 'feat-a')])).toEqual({
      persisted: new Set(),
      terminals: [],
    });
  });
});
