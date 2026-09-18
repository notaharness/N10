import type * as CoreModule from '@n10/core';
import { worktreeSessionKey } from '@n10/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionDiscoveryOptions } from '@n10/core';
import type * as DiscoveryModule from './discovery.js';
import type * as SessionsModule from './sessions.js';

/**
 * The desktop's half of external-session discovery.
 *
 * What decides *whether* a session should be attached to — the backend,
 * whether tmux still has it, whether this process already holds a PTY
 * for it — belongs to `@n10/core` and is tested in
 * `libs/core/src/lib/discovery`. `startSessionDiscovery` is stubbed here
 * so these tests can drive the callbacks the desktop supplies and assert
 * only on what the desktop contributes: the launch path an attach goes
 * through, the repositories it refuses to touch, and telling the
 * renderer.
 */

const state = vi.hoisted(() => ({
  cwd: '/repo-a',
  alive: new Set<string>(),
  spawns: [] as { name: string; cwd: string }[],
  onData: new Map<string, (data: string) => void>(),
  configByCwd: {} as Record<string, unknown>,
  createFails: new Set<string>(),
  /** Branches createWorktree was asked to resolve. */
  createWorktreeCalls: [] as string[],
  /** Options the most recent startSessionDiscovery call was given. */
  opts: null as SessionDiscoveryOptions | null,
  stops: 0,
  detached: [] as string[],
}));

vi.mock('./repo.js', () => ({
  requireRepo: () => state.cwd,
  activeRepoIs: (cwd: string) => cwd === state.cwd,
  isGitRepo: () => false,
}));

vi.mock('./recent-repos.js', () => ({
  ensureRecent: () => undefined,
}));

vi.mock('@n10/vcs-core', () => ({
  readConfig: (cwd: string) => state.configByCwd[cwd] ?? { fromCwd: cwd },
}));

vi.mock('@n10/worktree-manager', () => ({
  branchToSessionName: (branch: string) => branch.replace(/\//g, '-'),
  createWorktree: (branch: string) => {
    state.createWorktreeCalls.push(branch);
    if (state.createFails.has(branch)) {
      return Promise.reject(new Error(`git refused ${branch}`));
    }
    return Promise.resolve(`${state.cwd}/.claude/worktrees/${branch}`);
  },
}));

vi.mock('@n10/core', async (importOriginal) => {
  const actual = await importOriginal<typeof CoreModule>();
  return {
    worktreeSessionKey: actual.worktreeSessionKey,
    sessionLabel: actual.sessionLabel,
    sessionIdentity: actual.sessionIdentity,
    LOCAL_MACHINE: actual.LOCAL_MACHINE,
    startSessionDiscovery: (opts: SessionDiscoveryOptions) => {
      state.opts = opts;
      return {
        scanNow: () => Promise.resolve(),
        stop: () => {
          state.stops += 1;
        },
      };
    },
    launchSession: async (spec: { name: string; cwd: string }) => {
      await Promise.resolve();
      state.alive.add(spec.name);
      state.spawns.push({ name: spec.name, cwd: spec.cwd });
      return { name: spec.name };
    },
    launchTerminalSession: async (spec: { name: string; cwd: string }) => {
      await Promise.resolve();
      state.alive.add(spec.name);
      state.spawns.push({ name: spec.name, cwd: spec.cwd });
      return { name: spec.name };
    },
    getSession: (name: string) =>
      state.alive.has(name)
        ? {
            exited: false,
            pty: {
              onData: (cb: (data: string) => void) =>
                state.onData.set(name, cb),
              onExit: () => undefined,
              write: () => undefined,
              resize: () => undefined,
            },
          }
        : undefined,
    isSessionAlive: (name: string) => state.alive.has(name),
    hasSessionConnection: (name: string) => state.alive.has(name),
    hasPersistedTerminalSession: (name: string) => state.alive.has(name),
    killSession: () => undefined,
    detachSession: (name: string) => {
      state.detached.push(name);
      state.alive.delete(name);
    },
    checkoutPlan: () => Promise.resolve('spawned'),
    buildReviewLaunchRequest: () => ({ intent: 'blank' }),
    getSpawnedAt: () => 1000,
    noteInput: () => undefined,
    noteResize: () => undefined,
    noteSeen: () => undefined,
    snapshot: () => ({ active: false, flashing: false }),
  };
});

let discovery: typeof DiscoveryModule;
let sessions: typeof SessionsModule;

const worktree = (branch: string) => ({
  name: worktreeSessionKey(branch, state.cwd),
  branch,
  path: `/repo-a/.claude/worktrees/${branch}`,
});

/** The options the service handed the scanner. */
function opts(): SessionDiscoveryOptions {
  if (!state.opts) throw new Error('discovery was never started');
  return state.opts;
}

beforeEach(async () => {
  state.cwd = '/repo-a';
  state.alive = new Set();
  state.spawns = [];
  state.onData = new Map();
  state.configByCwd = {};
  state.createFails = new Set();
  state.createWorktreeCalls = [];
  state.opts = null;
  state.stops = 0;
  state.detached = [];

  vi.resetModules();
  sessions = await import('./sessions.js');
  sessions.setSessionBroadcaster(() => undefined);
  discovery = await import('./discovery.js');
});

describe('startDiscoveryForRepo', () => {
  it('attaches through the normal launch path, output relay and all', async () => {
    discovery.startDiscoveryForRepo('/repo-a');
    await opts().adopt(worktree('feature/x'));

    expect(state.spawns).toEqual([
      {
        name: worktreeSessionKey('feature/x', '/repo-a'),
        cwd: '/repo-a/.claude/worktrees/feature/x',
      },
    ]);
    // Adopted by the host, not merely spawned: without the relay the
    // agent runs with nothing forwarding it and the pane stays blank.
    state.onData.get(worktreeSessionKey('feature/x', '/repo-a'))?.(
      'agent says hello'
    );
    expect(
      sessions.getSessionBuffer(worktreeSessionKey('feature/x', '/repo-a')).data
    ).toBe('agent says hello');
    expect(sessions.listSessions().map((s) => s.name)).toEqual([
      worktreeSessionKey('feature/x', '/repo-a'),
    ]);
  });

  // The desktop is branch-keyed from the worktree it resolves down to
  // the tab it opens, so a detached-HEAD orphan has nothing to key on.
  // Rejecting (rather than quietly skipping) is what stops the scanner
  // offering it again on every tick.
  it('rejects a worktree with no branch instead of skipping it', async () => {
    discovery.startDiscoveryForRepo('/repo-a');
    await expect(
      opts().adopt({ name: 'detached', branch: '', path: '/wt/detached' })
    ).rejects.toThrow('no branch checked out');
    expect(state.spawns).toEqual([]);
  });

  // `createWorktree` resolves a directory from the branch name, so a
  // worktree someone put somewhere else is invisible to it — and
  // `git worktree add` for a branch that is already checked out fails.
  // The scanner already knows the real path, so it is used as-is.
  it('attaches in the worktree git reported, not one derived from the branch', async () => {
    discovery.startDiscoveryForRepo('/repo-a');
    await opts().adopt({
      name: worktreeSessionKey('my/branch', '/repo-a'),
      branch: 'my/branch',
      path: '/repo-a/.claude/worktrees/foo',
    });

    expect(state.spawns).toEqual([
      {
        name: worktreeSessionKey('my/branch', '/repo-a'),
        cwd: '/repo-a/.claude/worktrees/foo',
      },
    ]);
    expect(state.createWorktreeCalls).toEqual([]);
  });

  it('adopts the same branch independently in each repository', async () => {
    // A session alive under this name but owned by another repository:
    // the registry is keyed by bare branch name, so attaching would
    // hand this repo's tab the other repo's agent.
    state.cwd = '/repo-a';
    await sessions.launchAgent({
      branch: 'shared',
      intent: 'continue-or-blank',
    });
    state.cwd = '/repo-b';
    discovery.startDiscoveryForRepo('/repo-b');

    await opts().adopt(worktree('shared'));
    expect(state.spawns.map((s) => s.name)).toEqual([
      worktreeSessionKey('shared', '/repo-a'),
      worktreeSessionKey('shared', '/repo-b'),
    ]);
  });

  // The other thing the first scan brings back: terminal tabs. They
  // attach through the terminals service, under the name tmux holds
  // them by and in the directory tmux remembers, so the tab comes back
  // whatever repository happens to be open.
  it('attaches a surviving terminal through the terminals service', async () => {
    discovery.startDiscoveryForRepo('/repo-a');
    await opts().adoptTerminal?.({
      name: 'n10-shell',
      kind: 'shell',
      path: '/home/dev/notes',
    });
    expect(state.spawns).toEqual([
      { name: 'n10-shell', cwd: '/home/dev/notes' },
    ]);
    const terminals = await import('./terminals.js');
    expect(terminals.listTerminals().map((t) => t.name)).toEqual(['n10-shell']);
  });

  // A scan that began before a repo switch must not finish against the
  // new one: launchAgent would take this repo's branch names and create
  // them over there — phantom branches, worktrees and agents.
  it('reports itself stale once another repository is open', () => {
    discovery.startDiscoveryForRepo('/repo-a');
    expect(opts().isCurrent?.()).toBe(true);
    state.cwd = '/repo-b';
    expect(opts().isCurrent?.()).toBe(false);
  });

  it('stops the previous repo scanner before starting another', () => {
    discovery.startDiscoveryForRepo('/repo-a');
    expect(state.stops).toBe(0);
    discovery.startDiscoveryForRepo('/repo-b');
    expect(state.stops).toBe(1);
  });
});

describe('the change notification', () => {
  const delta = {
    appeared: [],
    disappeared: [],
    adoptable: [],
    ended: [],
    adoptableTerminals: [],
    endedTerminals: [],
    changed: true,
  };

  it('reaches the renderer', () => {
    const notify = vi.fn();
    discovery.setDiscoveryNotifier(notify);
    discovery.startDiscoveryForRepo('/repo-a');
    opts().onChanged(delta);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('forgets a retained agent tab when its tmux session is deleted externally', async () => {
    discovery.startDiscoveryForRepo('/repo-a');
    await opts().adoptTerminal?.({
      name: 'retained-agent',
      kind: 'agent',
      path: '/repo-a',
      running: false,
    });
    state.alive.delete('retained-agent');
    const terminals = await import('./terminals.js');
    expect(terminals.listTerminals()).toHaveLength(1);
    opts().onChanged({ ...delta, endedTerminals: ['retained-agent'] });
    expect(terminals.listTerminals()).toEqual([]);
    expect(state.detached).toEqual(['retained-agent']);
  });

  it('is harmless before main.ts has installed a notifier', () => {
    discovery.startDiscoveryForRepo('/repo-a');
    expect(() => opts().onChanged(delta)).not.toThrow();
  });
});

describe('stopDiscovery', () => {
  it('stops a running scanner', () => {
    discovery.startDiscoveryForRepo('/repo-a');
    discovery.stopDiscovery();
    expect(state.stops).toBe(1);
  });

  it('is safe with nothing running, and does not stop twice', () => {
    discovery.stopDiscovery();
    discovery.startDiscoveryForRepo('/repo-a');
    discovery.stopDiscovery();
    discovery.stopDiscovery();
    expect(state.stops).toBe(1);
  });
});
