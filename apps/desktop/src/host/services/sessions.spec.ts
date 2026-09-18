import type * as CoreModule from '@n10/core';
import { worktreeSessionKey } from '@n10/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as SessionsModule from './sessions.js';
import type { MachineView } from '../contract-machines.js';
import type { TaggedSession } from '@n10/core';

/** Sessions from multiple repositories coexist under qualified keys. */

const state = vi.hoisted(() => ({
  cwd: '/repo-a',
  alive: new Set<string>(),
  spawns: [] as {
    name: string;
    cwd: string;
    config: unknown;
    request: unknown;
    fresh?: boolean;
    expected?: unknown;
    agent?: { id: string };
  }[],
  killed: [] as string[],
  persistedKilled: [] as string[],
  persisted: new Set<string>(),
  entries: new Map<string, object>(),
  /** Native tmux incarnation name behind each session's PTY. */
  ptyNames: new Map<string, string>(),
  /** What a fresh `tmuxSessionSnapshot(pty.name)` answers, keyed by
   *  native name — absent means the read fails, as it would for a
   *  vanished target. */
  tmuxSnapshots: new Map<string, { incarnation: unknown }>(),
  onData: new Map<string, (data: string) => void>(),
  configByCwd: {} as Record<string, unknown>,
  createFails: new Set<string>(),
  /** Prompts core's checkoutPlan delivered into a live agent. */
  injected: [] as { name: string; prompt: string }[],
  /** Branch names whose checkout core should report as failed. */
  checkoutFails: new Set<string>(),
  createWorktreeCalls: [] as {
    branch: string;
    cwd: string;
    machine?: { id: string };
  }[],
  knownMachines: new Set<string>(),
  /** Names `reconnectSession` called the fake backend's `reconnect()` for. */
  reconnectCalls: [] as string[],
  /** Per-name `pty.connectionState`, read live (not just at entry
   *  creation) — finding 10's tests flip this after a session exists. */
  connectionStateByName: new Map<string, string>(),
  /** Paired machines `listMachines()` answers with, for the plan
   *  checkout's cross-machine duplicate-agent check. */
  machines: [] as MachineView[],
  /** Tagged sessions a remote machine's `list-sessions` would report,
   *  keyed by peerId. */
  remoteSessions: new Map<string, TaggedSession[]>(),
}));

vi.mock('./repo.js', () => ({
  requireRepo: () => state.cwd,
  activeRepoIs: (cwd: string) => cwd === state.cwd,
}));

vi.mock('@n10/vcs-core', () => ({
  readConfig: (cwd: string) => state.configByCwd[cwd] ?? { fromCwd: cwd },
}));

vi.mock('@n10/terminal-tmux', () => ({
  tmuxSessionSnapshot: (name: string) => state.tmuxSnapshots.get(name) ?? null,
  sameTmuxIncarnation: (
    a: Record<string, unknown>,
    b: Record<string, unknown>
  ) =>
    ['name', 'sessionId', 'paneId', 'panePid', 'serverPid'].every(
      (key) => a[key] === b[key]
    ),
}));

vi.mock('@n10/worktree-manager', () => ({
  branchToSessionName: (branch: string) => branch.replace(/\//g, '-'),
  createWorktree: (branch: string, cwd: string, machine?: { id: string }) => {
    state.createWorktreeCalls.push({ branch, cwd, machine });
    if (state.createFails.has(branch)) {
      return Promise.reject(new Error(`git refused ${branch}`));
    }
    return Promise.resolve(`${state.cwd}/.claude/worktrees/${branch}`);
  },
}));

vi.mock('./remote-machines.js', () => ({
  machineFor: (peerId: string) => {
    if (!state.knownMachines.has(peerId))
      throw new Error(`Machine "${peerId}" is not available`);
    return { id: peerId, executor: {}, ptyOpener: {} };
  },
}));

vi.mock('./machines.js', () => ({
  listMachines: () => Promise.resolve(state.machines),
}));

vi.mock('@n10/core', async (importOriginal) => {
  const actual = await importOriginal<typeof CoreModule>();
  return {
    worktreeSessionKey: actual.worktreeSessionKey,
    sessionLabel: actual.sessionLabel,
    sessionIdentity: actual.sessionIdentity,
    LOCAL_MACHINE: actual.LOCAL_MACHINE,
    resolveAgent: actual.resolveAgent,
    resolveWorktreeSession: actual.resolveWorktreeSession,
    listOurSessionsWith: (_executor: unknown, machine: string) =>
      Promise.resolve(state.remoteSessions.get(machine) ?? []),
    getSessionLaunchContext: () => ({
      exists: false,
      running: false,
      canResume: false,
    }),
    // Stands in for the real orchestrator, whose own branching is tested
    // in libs/core. What matters here is what the *desktop* does with
    // each outcome: inject changes nothing it tracks, a spawn has to be
    // adopted so its output reaches the renderer.
    checkoutPlan: (deps: {
      pr: { sourceBranch: string };
      prompt: string;
      mode: 'inject' | 'new-session';
      flashStatus: (msg: string) => void;
    }) => {
      const name = actual.worktreeSessionKey(deps.pr.sourceBranch, state.cwd);
      if (state.checkoutFails.has(deps.pr.sourceBranch)) {
        deps.flashStatus(
          `Failed to create worktree for ${deps.pr.sourceBranch}`
        );
        return Promise.resolve('failed');
      }
      if (
        (state.alive.has(name) || state.persisted.has(name)) &&
        deps.mode === 'inject'
      ) {
        state.alive.add(name);
        state.injected.push({ name, prompt: deps.prompt });
        return Promise.resolve('injected');
      }
      state.alive.add(name);
      state.spawns.push({
        name,
        cwd: `/wt/${deps.pr.sourceBranch}`,
        config: null,
        request: { intent: 'seed', prompt: deps.prompt },
      });
      return Promise.resolve('spawned');
    },
    buildAgentOptions: (config: { agentId?: string }) => [
      {
        name: `${config.agentId ?? 'Custom'} (default)`,
        agent: { id: config.agentId ?? 'test' },
      },
      { name: 'Codex', agent: { id: 'codex' } },
    ],
    buildReviewLaunchRequest: (pr: { id: number }, instruction?: string) => ({
      intent: 'review',
      prompt: `review #${pr.id}${instruction ? `: ${instruction}` : ''}`,
      systemGuidance: 'guidance',
    }),
    launchSession: async (spec: {
      name: string;
      cwd: string;
      config: unknown;
      request: unknown;
      fresh?: boolean;
      expected?: unknown;
      agent?: { id: string };
    }) => {
      await Promise.resolve();
      state.alive.add(spec.name);
      state.spawns.push({
        name: spec.name,
        cwd: spec.cwd,
        config: spec.config,
        request: spec.request,
        fresh: spec.fresh,
        expected: spec.expected,
        agent: spec.agent,
      });
    },
    getSession: (name: string) => {
      if (!state.alive.has(name)) return undefined;
      if (!state.entries.has(name))
        state.entries.set(name, {
          exited: false,
          pty: {
            name: state.ptyNames.get(name) ?? name,
            onData: (cb: (data: string) => void) => state.onData.set(name, cb),
            onExit: () => undefined,
            write: () => undefined,
            resize: () => undefined,
            reconnect: () => state.reconnectCalls.push(name),
            get connectionState() {
              return state.connectionStateByName.get(name);
            },
          },
        });
      return state.entries.get(name);
    },
    stopSession: (name: string) => {
      if (!state.alive.has(name) && !state.entries.has(name)) {
        state.persistedKilled.push(name);
        return;
      }
      state.killed.push(name);
      state.alive.delete(name);
      state.entries.delete(name);
    },
    isSessionAlive: (name: string) => state.alive.has(name),
    hasSessionConnection: (name: string) => state.alive.has(name),
    getSpawnedAt: () => 1000,
    noteInput: () => undefined,
    noteResize: () => undefined,
    noteSeen: () => undefined,
    snapshot: (name: string) => ({
      active: state.alive.has(name),
      flashing: false,
    }),
  };
});

// The service keeps its known-session map in module scope, which is
// exactly the state these tests are about — so each test gets a fresh
// module rather than inheriting the previous test's sessions.
let sessions: typeof SessionsModule;
let getSessionActivity: typeof sessions.getSessionActivity;
let getSessionBuffer: typeof sessions.getSessionBuffer;
let killSession: typeof sessions.killSession;
let launchAgent: typeof sessions.launchAgent;
let checkoutPlan: typeof sessions.checkoutPlan;
let launchReviewAgent: typeof sessions.launchReviewAgent;
let listSessions: typeof sessions.listSessions;
let reconnectSession: typeof sessions.reconnectSession;

beforeEach(async () => {
  state.cwd = '/repo-a';
  state.alive = new Set();
  state.spawns = [];
  state.killed = [];
  state.persistedKilled = [];
  state.persisted = new Set();
  state.entries = new Map();
  state.ptyNames = new Map();
  state.tmuxSnapshots = new Map();
  state.onData = new Map();
  state.configByCwd = {};
  state.createFails = new Set();
  state.injected = [];
  state.checkoutFails = new Set();
  state.createWorktreeCalls = [];
  state.knownMachines = new Set();
  state.reconnectCalls = [];
  state.connectionStateByName = new Map();
  state.machines = [];
  state.remoteSessions = new Map();

  vi.resetModules();
  sessions = await import('./sessions.js');
  ({
    checkoutPlan,
    getSessionActivity,
    getSessionBuffer,
    killSession,
    launchAgent,
    launchReviewAgent,
    listSessions,
    reconnectSession,
  } = sessions);
  sessions.setSessionBroadcaster(() => undefined);
});

/** Emit PTY output for a session, as the relay would. */
function emit(name: string, data: string) {
  state.onData.get(name)?.(data);
}

describe('launchAgent', () => {
  it('spawns the worktree session and reads config from the repo root', async () => {
    // Per-project config is keyed by a hash of the cwd, so reading it
    // from the worktree path resolves a different, empty bag.
    state.configByCwd['/repo-a'] = { marker: 'root-config' };
    await launchAgent({ branch: 'feature/x', intent: 'continue-or-blank' });

    expect(state.spawns).toHaveLength(1);
    expect(state.spawns[0].name).toBe(
      worktreeSessionKey('feature/x', '/repo-a')
    );
    expect(state.spawns[0].cwd).toBe('/repo-a/.claude/worktrees/feature/x');
    expect(state.spawns[0].config).toEqual({ marker: 'root-config' });
  });

  it('creates the worktree on the named machine and keys the session with it (D2, D5)', async () => {
    state.knownMachines.add('peer-abc');
    await launchAgent({
      branch: 'feature/x',
      intent: 'continue-or-blank',
      machine: 'peer-abc',
    });
    expect(state.createWorktreeCalls[0]).toMatchObject({
      branch: 'feature/x',
      cwd: '/repo-a',
      machine: { id: 'peer-abc' },
    });
    expect(state.spawns[0].name).toBe(
      worktreeSessionKey('feature/x', '/repo-a', 'peer-abc')
    );
  });

  it('fails loudly rather than launching locally when the named machine is not available', async () => {
    // peer-abc is never added to state.knownMachines.
    await expect(
      launchAgent({
        branch: 'feature/x',
        intent: 'continue-or-blank',
        machine: 'peer-abc',
      })
    ).rejects.toThrow(/not available/);
    expect(state.createWorktreeCalls).toHaveLength(0);
    expect(state.spawns).toHaveLength(0);
  });

  it('emits worktree then start steps for a remote launch, keyed to launchId', async () => {
    state.knownMachines.add('peer-abc');
    const broadcasts: unknown[] = [];
    sessions.setSessionBroadcaster((channel, payload) => {
      if (channel === 'n10/launch/step') broadcasts.push(payload);
    });
    await launchAgent({
      branch: 'feature/x',
      intent: 'continue-or-blank',
      machine: 'peer-abc',
      launchId: 'launch-1',
    });
    expect(broadcasts).toEqual([
      { launchId: 'launch-1', step: 'worktree' },
      { launchId: 'launch-1', step: 'start' },
    ]);
  });

  it('emits no steps for a local launch', async () => {
    const broadcasts: unknown[] = [];
    sessions.setSessionBroadcaster((channel, payload) => {
      if (channel === 'n10/launch/step') broadcasts.push(payload);
    });
    await launchAgent({ branch: 'feature/x', intent: 'continue-or-blank' });
    expect(broadcasts).toEqual([]);
  });

  it('a local launch never touches the machine resolver, and creates the worktree exactly as today', async () => {
    await launchAgent({ branch: 'feature/x', intent: 'continue-or-blank' });
    expect(state.createWorktreeCalls[0]).toMatchObject({
      branch: 'feature/x',
      cwd: '/repo-a',
      machine: undefined,
    });
    expect(state.spawns[0].name).toBe(
      worktreeSessionKey('feature/x', '/repo-a')
    );
  });

  it('launches a per-launch agent pick over the stored config', async () => {
    state.configByCwd['/repo-a'] = { agentId: 'claude', marker: 'root' };
    await launchAgent({
      branch: 'feature/x',
      intent: 'continue-or-blank',
      agentId: 'codex',
    });
    expect(state.spawns[0].config).toEqual({
      agentId: 'codex',
      marker: 'root',
    });
  });

  it('collapses overlapping launches of the same branch into one spawn', async () => {
    // A double-click can race the renderer's isPending flag; a second
    // spawn would dispose the first PTY and attach a duplicate relay.
    const [a, b] = await Promise.all([
      launchAgent({ branch: 'race', intent: 'continue-or-blank' }),
      launchAgent({ branch: 'race', intent: 'continue-or-blank' }),
    ]);
    expect(a).toEqual(b);
    expect(state.spawns).toHaveLength(1);
  });

  it('does not collapse a fresh request into a pending continuation', async () => {
    const first = launchAgent({ branch: 'race', intent: 'continue-or-blank' });
    await expect(
      launchAgent({ branch: 'race', intent: 'blank', fresh: true })
    ).rejects.toThrow('Another launch is in progress');
    await first;
    expect(state.spawns).toHaveLength(1);
  });

  it('forwards an explicit fresh replacement and selected agent for a live session', async () => {
    await launchAgent({ branch: 'fresh', intent: 'continue-or-blank' });
    const expected = {
      name: 'native',
      sessionId: '$1',
      paneId: '%2',
      panePid: 123,
      serverPid: 100,
    };
    await launchAgent({
      branch: 'fresh',
      intent: 'blank',
      fresh: true,
      expected,
      agentId: 'codex',
    });
    expect(state.spawns).toHaveLength(2);
    expect(state.spawns[1]).toMatchObject({
      fresh: true,
      expected,
      agent: { id: 'codex' },
      request: { intent: 'blank' },
    });
  });

  it('reattaches to its own live session instead of respawning', async () => {
    await launchAgent({ branch: 'again', intent: 'continue-or-blank' });
    await launchAgent({ branch: 'again', intent: 'continue-or-blank' });
    expect(state.spawns).toHaveLength(1);
  });
});

describe('reusing an already-attached connection', () => {
  // LaunchDialog always sends `expected` (the incarnation it read when it
  // opened), so "Open Claude" on an already-connected session must still
  // reuse the connection instead of tearing down and re-attaching the PTY.
  const name = () => worktreeSessionKey('reuse', '/repo-a');
  const incarnationFor = (nativeName: string) => ({
    name: nativeName,
    sessionId: '$1',
    paneId: '%2',
    panePid: 123,
    serverPid: 100,
  });

  it('reuses the connection when the expected incarnation matches the live snapshot', async () => {
    await launchAgent({ branch: 'reuse', intent: 'continue-or-blank' });
    expect(state.spawns).toHaveLength(1);
    state.tmuxSnapshots.set(name(), { incarnation: incarnationFor(name()) });

    await launchAgent({
      branch: 'reuse',
      intent: 'continue-or-blank',
      expected: incarnationFor(name()),
    });
    expect(state.spawns).toHaveLength(1);
  });

  it('does not reuse when the live snapshot no longer matches the expected incarnation', async () => {
    await launchAgent({ branch: 'reuse', intent: 'continue-or-blank' });
    // The live session was killed and recreated under this same tmux
    // label (labels are reused after a kill — see tmux-launch.ts's
    // free-name probe), so a fresh snapshot's native fields differ from
    // what the dialog captured even though the label is unchanged.
    state.tmuxSnapshots.set(name(), {
      incarnation: { ...incarnationFor(name()), sessionId: '$99' },
    });

    await launchAgent({
      branch: 'reuse',
      intent: 'continue-or-blank',
      expected: incarnationFor(name()),
    });
    expect(state.spawns).toHaveLength(2);
  });

  it('does not reuse when the live snapshot cannot be read', async () => {
    await launchAgent({ branch: 'reuse', intent: 'continue-or-blank' });
    state.tmuxSnapshots.delete(name());

    await launchAgent({
      branch: 'reuse',
      intent: 'continue-or-blank',
      expected: incarnationFor(name()),
    });
    expect(state.spawns).toHaveLength(2);
  });

  it('does not reuse a fresh request even when the incarnation matches', async () => {
    await launchAgent({ branch: 'reuse', intent: 'continue-or-blank' });
    state.tmuxSnapshots.set(name(), { incarnation: incarnationFor(name()) });

    await launchAgent({
      branch: 'reuse',
      intent: 'blank',
      fresh: true,
      expected: incarnationFor(name()),
    });
    expect(state.spawns).toHaveLength(2);
  });

  // Finding 9: tmux session labels are `<repo>-<branch>` on both
  // machines, so a *local* tmux session sharing the exact native name
  // a remote one's registry key resolves to could otherwise answer for
  // its incarnation check. `state.tmuxSnapshots` here is keyed exactly
  // the way a colliding local session would be (the local mocks in
  // this suite use the same string for a registry key and its native
  // pty name throughout) — so the test only passes if the guard never
  // asks local tmux at all for a remote session, not merely that this
  // particular snapshot happens to disagree.
  it('does not reuse a remote session by asking local tmux for its incarnation', async () => {
    state.knownMachines.add('peer-1');
    const remoteName = worktreeSessionKey('reuse-remote', '/repo-a', 'peer-1');
    await launchAgent({
      branch: 'reuse-remote',
      intent: 'continue-or-blank',
      machine: 'peer-1',
    });
    expect(state.spawns).toHaveLength(1);
    state.tmuxSnapshots.set(remoteName, {
      incarnation: incarnationFor(remoteName),
    });

    await launchAgent({
      branch: 'reuse-remote',
      intent: 'continue-or-blank',
      machine: 'peer-1',
      expected: incarnationFor(remoteName),
    });
    expect(state.spawns).toHaveLength(2);
  });
});

describe('listSessions: a local session never carries a connectionState (finding 10)', () => {
  it('omits connectionState for a local session even when the PTY reports one', async () => {
    const name = worktreeSessionKey('local-conn', '/repo-a');
    await launchAgent({ branch: 'local-conn', intent: 'continue-or-blank' });
    // TmuxBackend's own local-client reconnect (a distinct, older
    // concern than the remote D4 banner) can legitimately report this
    // — it must still never reach the renderer for a local session.
    state.connectionStateByName.set(name, 'reconnecting');
    const summary = listSessions().find((s) => s.name === name);
    expect(summary?.connectionState).toBeUndefined();
  });

  it('still reports connectionState for a remote session', async () => {
    state.knownMachines.add('peer-1');
    const name = worktreeSessionKey('remote-conn', '/repo-a', 'peer-1');
    await launchAgent({
      branch: 'remote-conn',
      intent: 'continue-or-blank',
      machine: 'peer-1',
    });
    state.connectionStateByName.set(name, 'reconnecting');
    const summary = listSessions().find((s) => s.name === name);
    expect(summary?.connectionState).toBe('reconnecting');
  });
});

describe('another repository owns the name', () => {
  /** Launch `branch` in repo A, then switch to repo B. */
  async function launchInAThenSwitch(branch = 'shared') {
    state.cwd = '/repo-a';
    await launchAgent({ branch, intent: 'continue-or-blank' });
    emit(worktreeSessionKey(branch, '/repo-a'), 'repo-a secrets');
    state.cwd = '/repo-b';
  }

  it('launches the same branch in another repository without replacing the first agent', async () => {
    await launchInAThenSwitch();
    const second = await launchAgent({
      branch: 'shared',
      intent: 'continue-or-blank',
    });
    expect(second.name).toBe(worktreeSessionKey('shared', '/repo-b'));
    expect(state.spawns).toHaveLength(2);
    expect(state.alive.has(worktreeSessionKey('shared', '/repo-a'))).toBe(true);
    expect(listSessions().map((s) => s.name)).toEqual([second.name]);
  });

  it('refuses to kill it', async () => {
    await launchInAThenSwitch();
    expect(() => killSession(worktreeSessionKey('shared', '/repo-a'))).toThrow(
      'belongs to another repository'
    );
    expect(state.killed).toEqual([]);
  });

  it('hides it from the session list', async () => {
    await launchInAThenSwitch();
    expect(listSessions()).toEqual([]);
    state.cwd = '/repo-a';
    expect(listSessions().map((s) => s.name)).toEqual([
      worktreeSessionKey('shared', '/repo-a'),
    ]);
  });

  it('hides it from the activity map', async () => {
    await launchInAThenSwitch();
    expect(getSessionActivity()).toEqual({});
  });

  it('does not hand over its scrollback', async () => {
    await launchInAThenSwitch();
    // The buffer holds whatever the other repo's agent printed.
    expect(getSessionBuffer(worktreeSessionKey('shared', '/repo-a')).data).toBe(
      ''
    );
    state.cwd = '/repo-a';
    expect(getSessionBuffer(worktreeSessionKey('shared', '/repo-a')).data).toBe(
      'repo-a secrets'
    );
  });

  it('reports it as not alive here, so this repo does not show it running', () => {
    // The sidebar asks this per worktree row. `isSessionAlive` alone is
    // answered from a registry keyed by the bare branch name, so the
    // other repo's agent would make this repo's same-named row look
    // live — and `sync-items` would auto-open a tab onto an agent this
    // repo cannot reach, kill or relaunch.
    return launchInAThenSwitch().then(() => {
      expect(
        sessions.isOwnSessionAlive(worktreeSessionKey('shared', '/repo-a'))
      ).toBe(false);
      state.cwd = '/repo-a';
      expect(
        sessions.isOwnSessionAlive(worktreeSessionKey('shared', '/repo-a'))
      ).toBe(true);
    });
  });

  it('skips it during worktree removal instead of killing it', async () => {
    await launchInAThenSwitch();
    // Housekeeping inside a legitimate operation: removing this repo's
    // `shared` worktree must not reach the other repo's agent, and must
    // not abort the removal either.
    expect(() =>
      sessions.killOwnSession(worktreeSessionKey('shared', '/repo-a'))
    ).not.toThrow();
    expect(state.killed).toEqual([]);
    state.cwd = '/repo-a';
    sessions.killOwnSession(worktreeSessionKey('shared', '/repo-a'));
    expect(state.killed).toEqual([worktreeSessionKey('shared', '/repo-a')]);
  });

  it('treats a discovered session as the repo that discovered it', async () => {
    // Discovery attaches by calling `launchAgent` with the checkout git
    // reported, so a session it picks up is recorded like any other —
    // under whichever repo was open at the time. The ownership guards
    // read that record, so the two have to agree: a worktree found in
    // this repo counts as ours, and one found over there does not
    // become ours by sharing a branch name.
    state.cwd = '/repo-a';
    await launchAgent(
      { branch: 'shared', intent: 'continue-or-blank' },
      '/repo-a/elsewhere/shared'
    );
    expect(
      sessions.isOwnSessionAlive(worktreeSessionKey('shared', '/repo-a'))
    ).toBe(true);

    state.cwd = '/repo-b';
    expect(
      sessions.isOwnSessionAlive(worktreeSessionKey('shared', '/repo-a'))
    ).toBe(false);
    await launchAgent(
      { branch: 'shared', intent: 'continue-or-blank' },
      '/repo-b/elsewhere/shared'
    );
    expect(state.spawns).toHaveLength(2);
    sessions.killOwnSession(worktreeSessionKey('shared', '/repo-a'));
    expect(state.killed).toEqual([]);
  });

  it('ignores names without a worktree identity', () => {
    // No entry means no ownership claim — killing is a no-op there
    // rather than an error, matching the registry's own behaviour.
    expect(() => killSession('never-seen')).not.toThrow();
    expect(state.killed).toEqual([]);
    expect(state.persistedKilled).toEqual([]);
  });
});

describe('session buffer', () => {
  it('accumulates output with a monotonic sequence number', async () => {
    await launchAgent({ branch: 'buf', intent: 'continue-or-blank' });
    emit(worktreeSessionKey('buf', '/repo-a'), 'one ');
    emit(worktreeSessionKey('buf', '/repo-a'), 'two');

    // The seq lets a late subscriber drop chunks the snapshot covered.
    expect(getSessionBuffer(worktreeSessionKey('buf', '/repo-a'))).toEqual({
      data: 'one two',
      seq: 2,
    });
  });

  it('is empty for a session that was never launched', () => {
    expect(getSessionBuffer('nothing')).toEqual({ data: '', seq: 0 });
  });

  it('drops the oldest output once the buffer is full', async () => {
    await launchAgent({ branch: 'big', intent: 'continue-or-blank' });
    const chunk = 'x'.repeat(256 * 1024);
    emit(worktreeSessionKey('big', '/repo-a'), chunk);
    emit(worktreeSessionKey('big', '/repo-a'), chunk);
    emit(worktreeSessionKey('big', '/repo-a'), chunk);

    // Bounded at 512 KiB: the scrollback stays useful without letting a
    // chatty agent grow the main process without limit.
    const { data } = getSessionBuffer(worktreeSessionKey('big', '/repo-a'));
    expect(data.length).toBeLessThanOrEqual(512 * 1024);
    expect(data.length).toBeGreaterThan(0);
  });
});

describe('reconnectSession', () => {
  it('calls the backend’s manual retry (the pane’s Reconnect action)', async () => {
    await launchAgent({ branch: 'buf', intent: 'continue-or-blank' });
    const name = worktreeSessionKey('buf', '/repo-a');
    reconnectSession(name);
    expect(state.reconnectCalls).toEqual([name]);
  });

  it('is a no-op for a session that is not there', () => {
    expect(() => reconnectSession('nothing')).not.toThrow();
  });
});

describe('launchReviewAgent', () => {
  it('launches on the pull request branch with the review prompt', async () => {
    // The prompt and guidance come from app-core so the desktop and the
    // TUI seed a review identically; the branch is the PR's source, not
    // whatever is checked out.
    await launchReviewAgent({
      pr: { id: 42, sourceBranch: 'feature/review' },
      instruction: 'focus on error handling',
    } as Parameters<typeof launchReviewAgent>[0]);

    expect(state.spawns).toHaveLength(1);
    expect(state.spawns[0].name).toBe(
      worktreeSessionKey('feature/review', '/repo-a')
    );
    expect(state.spawns[0].request).toMatchObject({
      intent: 'seed',
      prompt: 'review #42: focus on error handling',
      systemGuidance: 'guidance',
    });
  });

  it('rejects overlapping reviews with different instructions instead of dropping a prompt', async () => {
    const pr = { id: 1, sourceBranch: 'dup' } as Parameters<
      typeof launchReviewAgent
    >[0]['pr'];
    const first = launchReviewAgent({ pr, instruction: 'first' });
    await expect(
      launchReviewAgent({ pr, instruction: 'second' })
    ).rejects.toThrow('Another launch is in progress');
    await first;
    expect(state.spawns[0].request).toMatchObject({
      prompt: 'review #1: first',
    });
  });

  it('forwards the selected review agent and guarded fresh intent', async () => {
    const pr = { id: 1, sourceBranch: 'selected' } as Parameters<
      typeof launchReviewAgent
    >[0]['pr'];
    await launchReviewAgent({ pr, agentId: 'codex' });
    expect(state.spawns[0]).toMatchObject({
      fresh: true,
      agent: { id: 'codex' },
      request: {
        intent: 'seed',
        prompt: 'review #1',
        systemGuidance: 'guidance',
      },
    });
  });

  it('goes through the same de-duplication as a plain launch', async () => {
    const pr = { id: 1, sourceBranch: 'dup' };
    await Promise.all([
      launchReviewAgent({ pr } as Parameters<typeof launchReviewAgent>[0]),
      launchReviewAgent({ pr } as Parameters<typeof launchReviewAgent>[0]),
    ]);
    expect(state.spawns).toHaveLength(1);
  });
});

// ── Plan checkout ────────────────────────────────────────────────

describe('checkoutPlan', () => {
  const pr = { id: 7, sourceBranch: 'feature/x' } as never;
  const req = (mode: 'inject' | 'new-session' = 'new-session') => ({
    pr,
    prompt: 'Resolve these PR review comments:\n\n### 1. a.ts:1\n@a: fix it',
    mode,
  });

  it('adopts a spawned session so its output reaches the renderer', async () => {
    // core does the spawning; without the host adopting it, the PTY
    // runs with nothing relaying it and the terminal pane stays blank.
    await expect(checkoutPlan(req())).resolves.toBe('spawned');
    emit(worktreeSessionKey('feature/x', '/repo-a'), 'agent says hello');
    expect(
      getSessionBuffer(worktreeSessionKey('feature/x', '/repo-a')).data
    ).toBe('agent says hello');
    expect(listSessions().map((s) => s.name)).toEqual([
      worktreeSessionKey('feature/x', '/repo-a'),
    ]);
  });

  it('relays output when injection attaches a persisted agent for the first time', async () => {
    const name = worktreeSessionKey('feature/x', '/repo-a');
    state.persisted.add(name);
    const request = req('inject');
    await expect(checkoutPlan(request)).resolves.toBe('injected');
    emit(name, 'persisted agent output');
    expect(getSessionBuffer(name).data).toBe('persisted agent output');
    expect(listSessions().map((session) => session.name)).toContain(name);
  });

  it('injecting neither spawns nor disturbs the scrollback', async () => {
    await launchAgent({ branch: 'feature/x', intent: 'continue-or-blank' });
    emit(worktreeSessionKey('feature/x', '/repo-a'), 'existing conversation');
    state.spawns = [];

    await expect(checkoutPlan(req('inject'))).resolves.toBe('injected');

    expect(state.spawns).toEqual([]);
    expect(state.injected).toEqual([
      {
        name: worktreeSessionKey('feature/x', '/repo-a'),
        prompt: req().prompt,
      },
    ]);
    // The pane is showing this text; a reset would blank it.
    expect(
      getSessionBuffer(worktreeSessionKey('feature/x', '/repo-a')).data
    ).toBe('existing conversation');
  });

  /**
   * A mounted terminal remembers the sequence number its replay ended
   * at and drops anything at or below it. Numbering a restarted
   * session's chunks from 1 again therefore makes the new agent look
   * dead in a pane that is still on screen — which is exactly the pane
   * you are looking at when you restart one with a plan.
   */
  it('keeps chunk numbering monotonic when it restarts a session', async () => {
    await launchAgent({ branch: 'feature/x', intent: 'continue-or-blank' });
    emit(worktreeSessionKey('feature/x', '/repo-a'), 'first run');
    const before = getSessionBuffer(
      worktreeSessionKey('feature/x', '/repo-a')
    ).seq;
    expect(before).toBe(1);

    await checkoutPlan(req('new-session'));
    emit(worktreeSessionKey('feature/x', '/repo-a'), 'second run');

    const after = getSessionBuffer(worktreeSessionKey('feature/x', '/repo-a'));
    expect(after.seq).toBeGreaterThan(before);
    // The scrollback itself does start over — it is a new agent.
    expect(after.data).toBe('second run');
  });

  it('rejects with the reason, so the plan can be retried', async () => {
    state.checkoutFails.add('feature/x');
    await expect(checkoutPlan(req())).rejects.toThrow(
      'Failed to create worktree for feature/x'
    );
  });

  it('refuses to deliver into another repository’s agent', async () => {
    state.cwd = '/repo-a';
    await launchAgent({ branch: 'feature/x', intent: 'continue-or-blank' });
    state.cwd = '/repo-b';

    await expect(checkoutPlan(req('inject'))).resolves.toBe('spawned');
    expect(state.spawns.at(-1)?.name).toBe(
      worktreeSessionKey('feature/x', '/repo-b')
    );
    expect(state.injected).toEqual([]);
  });

  it('collapses a double-send into one delivery', async () => {
    const [a, b] = await Promise.all([
      checkoutPlan(req()),
      checkoutPlan(req()),
    ]);
    expect([a, b]).toEqual(['spawned', 'spawned']);
    expect(state.spawns).toHaveLength(1);
  });

  // ── Cross-machine duplicate agent (Phase 8's closed hole) ─────────
  //
  // checkoutPlan used to resolve a branch's session by *local* state
  // only, so a branch whose agent runs on another paired machine found
  // nothing here and spawned a second, local agent for it — the exact
  // duplicate-agent shape a whole review round closed on the launch
  // path (open-session.ts's findSession), just left open on this one.

  function connectedMachine(peerId: string, label: string): MachineView {
    return {
      peerId,
      label,
      isLocal: false,
      state: 'connected',
      transport: 'WebSocket',
      endpoints: ['http://peer'],
      lastSeenAt: 1000,
      queueDepth: 0,
      pairedAt: 1000,
      revokedAt: null,
      inboundWaiting: [],
      inboundRefused: [],
    };
  }

  function remoteWorktreeSession(
    repo: string,
    branch: string,
    machine: string
  ): TaggedSession {
    return {
      name: `n10-${branch.replace(/\//g, '-')}`,
      created: 1,
      paneDead: false,
      path: '/wherever',
      spawner: 'kirby',
      repo,
      type: 'worktree',
      branch,
      machine,
    };
  }

  it('refuses, naming the machine, when the branch already has an agent running elsewhere', async () => {
    state.knownMachines.add('peer-1');
    state.machines = [connectedMachine('peer-1', 'workbox')];
    state.remoteSessions.set('peer-1', [
      remoteWorktreeSession('/repo-a', 'feature/x', 'peer-1'),
    ]);

    await expect(checkoutPlan(req())).rejects.toThrow(/workbox/);
    expect(state.spawns).toEqual([]);
    expect(state.createWorktreeCalls).toEqual([]);
  });

  it('does not refuse for a same-named branch in a different repository on that machine', async () => {
    state.knownMachines.add('peer-1');
    state.machines = [connectedMachine('peer-1', 'workbox')];
    state.remoteSessions.set('peer-1', [
      remoteWorktreeSession('/some-other-repo', 'feature/x', 'peer-1'),
    ]);

    await expect(checkoutPlan(req())).resolves.toBe('spawned');
  });

  it('ignores a machine that is paired but not connected — nothing to ask', async () => {
    state.machines = [
      { ...connectedMachine('peer-1', 'workbox'), state: 'unreachable' },
    ];
    state.remoteSessions.set('peer-1', [
      remoteWorktreeSession('/repo-a', 'feature/x', 'peer-1'),
    ]);

    await expect(checkoutPlan(req())).resolves.toBe('spawned');
  });

  it('proceeds locally when no paired machine is running that branch', async () => {
    state.knownMachines.add('peer-1');
    state.machines = [connectedMachine('peer-1', 'workbox')];
    state.remoteSessions.set('peer-1', []);

    await expect(checkoutPlan(req())).resolves.toBe('spawned');
  });
});

describe('listAgentOptions', () => {
  it('lists the repo config default first, then the rest of the registry', () => {
    state.configByCwd['/repo-a'] = { agentId: 'claude' };
    expect(sessions.listAgentOptions()).toEqual([
      { id: 'claude', name: 'claude (default)' },
      { id: 'codex', name: 'Codex' },
    ]);
  });

  it('labels a custom command as the hidden test runner', () => {
    state.configByCwd['/repo-a'] = { aiCommand: 'node fake.mjs' };
    expect(sessions.listAgentOptions()[0]).toEqual({
      id: 'test',
      name: 'Custom (default)',
    });
  });
});

describe('stopping persisted sessions', () => {
  it('stops a retained worktree session with no local connection', () => {
    const name = worktreeSessionKey('retained', '/repo-a');
    killSession(name);
    expect(state.persistedKilled).toEqual([name]);
  });

  it('does not stop an unregistered session from another repository', () => {
    killSession(worktreeSessionKey('retained', '/repo-b'));
    expect(state.persistedKilled).toEqual([]);
    expect(state.killed).toEqual([]);
  });

  it('does not stop a foreign registry entry that was never adopted by this host', () => {
    const name = worktreeSessionKey('retained', '/repo-b');
    state.alive.add(name);
    killSession(name);
    sessions.killOwnSession(name);
    expect(state.alive.has(name)).toBe(true);
    expect(state.killed).toEqual([]);
    expect(state.persistedKilled).toEqual([]);
  });
});
