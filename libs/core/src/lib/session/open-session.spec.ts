import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaggedSession } from '../session-identity.js';
const state = vi.hoisted(() => ({
  existing: null as TaggedSession | null,
  create: vi.fn<(spec: unknown, plan: unknown) => { name: string }>(() => ({
    name: 'allocated',
  })),
  createRemote: vi.fn<
    (
      spec: unknown,
      plan: unknown,
      machine: unknown,
      poller: unknown
    ) => {
      name: string;
    }
  >(() => ({ name: 'remote-allocated' })),
  register: vi.fn(),
  head: vi.fn(),
  held: vi.fn(() => false),
  machine: { id: 'peer-abc', executor: {} } as unknown,
  requireMachine: vi.fn(() => state.machine),
  pollerFor: vi.fn(() => 'the-poller'),
  listOurSessionsWith: vi.fn<
    (executor: unknown, machine: string) => Promise<TaggedSession[]>
  >(async () => []),
}));
vi.mock('@n10/terminal-tmux', () => ({
  createTmuxBackend: state.create,
  createRemoteTmuxBackend: state.createRemote,
}));
vi.mock('../pty-registry.js', () => ({
  spawnSession: state.register,
  sessionNames: () => [],
}));
// Honours the `sessions` argument rather than ignoring it (finding 5,
// second pass): `undefined` means a local call (findSession passes no
// list, letting the real resolver default to local tmux) and returns
// `state.existing` for the local-suite tests below; an array means a
// remote call whose `sessions` came from `listOurSessionsWith`, and the
// match must actually be found in it. Without this, a regression where
// `findSession` resolved a remote request against `undefined` (i.e.
// local tmux) would still pass every remote test in this file, because
// the old mock returned `state.existing` no matter what it was called
// with — see the "finding 7" tests below, which no longer set
// `state.existing` and rely entirely on this honouring the array.
vi.mock('../session-resolver.js', () => ({
  resolveSessionByName: (name: string, sessions?: TaggedSession[]) =>
    sessions === undefined
      ? state.existing
      : sessions.find((s) => s.name === name) ?? null,
  resolveWorktreeSession: (
    repo: string,
    branch: string,
    sessions?: TaggedSession[]
  ) =>
    sessions === undefined
      ? state.existing
      : sessions.find((s) => s.repo === repo && s.branch === branch) ?? null,
  listOurSessions: () => [],
  listOurSessionsWith: state.listOurSessionsWith,
}));
vi.mock('../discovery/worktree-origin.js', () => ({
  readWorktreeHead: state.head,
}));
vi.mock('../machine-registry.js', () => ({
  requireMachine: state.requireMachine,
  pollerFor: state.pollerFor,
}));
import { openSession, type OpenSessionParams } from './open-session.js';
const build = vi.fn(() => ({
  spec: { cmd: 'codex', args: [] },
  agent: 'codex',
}));
const base: OpenSessionParams = {
  session: { type: 'worktree', repo: '/repo', branch: 'feature/x' },
  cwd: '/repo/worktree',
  cols: 80,
  rows: 24,
  build,
};
const found: TaggedSession = {
  name: 'unrelated-label',
  repo: '/repo',
  branch: 'feature/x',
  path: base.cwd,
  type: 'worktree',
  spawner: 'orchestra',
  agent: 'claude',
  machine: 'local',
  created: 1,
  paneDead: false,
};
beforeEach(() => {
  vi.clearAllMocks();
  state.existing = null;
  state.head.mockReturnValue({ branch: 'feature/x' });
  state.listOurSessionsWith.mockResolvedValue([]);
});
describe('session launch boundary', () => {
  it('coalesces concurrent requests for the same worktree', async () => {
    await Promise.all([openSession(base), openSession(base)]);
    expect(state.create).toHaveBeenCalledOnce();
    expect(state.register).toHaveBeenCalledOnce();
  });
  it('attaches a running session without constructing any agent command', async () => {
    state.existing = found;
    await openSession(base);
    expect(build).not.toHaveBeenCalled();
    expect(state.create.mock.calls[0][1]).toEqual({
      mode: 'attach',
      target: found.name,
    });
    expect(state.register).toHaveBeenCalledWith(
      '["worktree","/repo","feature/x"]',
      expect.anything(),
      80,
      24,
      'claude'
    );
  });
  it('attaches an exited pane for discovery without restarting it', async () => {
    state.existing = { ...found, paneDead: true };
    await openSession({ ...base, mode: 'attach' });
    expect(build).not.toHaveBeenCalled();
    expect(state.create.mock.calls[0][1]).toMatchObject({ mode: 'attach' });
  });
  it('restarts an exited agent with its recorded identity and preserves creator tags', async () => {
    state.existing = { ...found, paneDead: true };
    await openSession(base);
    expect(build).toHaveBeenCalledWith('claude', true);
    expect(state.create.mock.calls[0][1]).toEqual({
      mode: 'restart',
      target: found.name,
      tags: { '@orchestra-agent': 'codex' },
      retainOnExit: true,
    });
  });
  it('requires captured approval for a fresh live replacement', async () => {
    state.existing = found;
    await expect(openSession({ ...base, fresh: true })).rejects.toThrow(
      'confirmation'
    );
    expect(state.create).not.toHaveBeenCalled();
  });
  it('rejects a vanished expected target instead of creating a different conversation', async () => {
    await expect(
      openSession({
        ...base,
        expected: {
          name: found.name,
          sessionId: '$1',
          paneId: '%2',
          panePid: 300,
          serverPid: 100,
        },
      })
    ).rejects.toThrow('Session changed');
    expect(state.create).not.toHaveBeenCalled();
    expect(build).not.toHaveBeenCalled();
  });
  it('uses non-k restart for unconfirmed dead fresh launches and clears only reporting metadata', async () => {
    state.existing = { ...found, paneDead: true };
    await openSession({ ...base, build: () => ({ ...build(), fresh: true }) });
    expect(state.create.mock.calls[0][1]).toEqual({
      mode: 'restart',
      target: found.name,
      retainOnExit: true,
      tags: {
        '@orchestra-agent': 'codex',
        '@orchestra-orchestrator': null,
        '@orchestra-last-report': null,
      },
    });
    expect(state.create.mock.calls[0][0]).toMatchObject({
      envAdditions: { ORCHESTRA_SESSION: '', ORCHESTRA_SOCKET: '' },
    });
  });
  it('does not coalesce a fresh intent into an in-flight discovery attachment', async () => {
    state.existing = found;
    const attachment = openSession({ ...base, mode: 'attach' });
    await expect(openSession({ ...base, intent: 'fresh' })).rejects.toThrow(
      'in progress'
    );
    await attachment;
    expect(state.create).toHaveBeenCalledOnce();
  });
  it('records identity and the actual selected agent on creation', async () => {
    await openSession(base);
    expect(state.create.mock.calls[0][1]).toMatchObject({
      mode: 'create',
      tags: {
        '@orchestra-repo': '/repo',
        '@orchestra-branch': 'feature/x',
        '@orchestra-agent': 'codex',
      },
      retainOnExit: true,
    });
  });
  it('fails a vanished attach instead of launching a replacement', async () => {
    await expect(openSession({ ...base, mode: 'attach' })).rejects.toThrow(
      'ended'
    );
    expect(build).not.toHaveBeenCalled();
    expect(state.create).not.toHaveBeenCalled();
  });
  it('rejects the wrong checkout before touching an existing connection', async () => {
    state.head.mockReturnValue({ branch: 'other' });
    await expect(openSession(base)).rejects.toThrow('other');
    expect(state.create).not.toHaveBeenCalled();
    expect(state.register).not.toHaveBeenCalled();
  });
});

describe('remote sessions (D2/D4/D5): the machine in the request reaches the plan', () => {
  it('routes a remote request through createRemoteTmuxBackend, never the local backend', async () => {
    await openSession({
      ...base,
      session: {
        type: 'worktree',
        repo: '/repo',
        branch: 'feature/x',
        machine: 'peer-abc',
      },
    });
    expect(state.create).not.toHaveBeenCalled();
    expect(state.createRemote).toHaveBeenCalledOnce();
    expect(state.requireMachine).toHaveBeenCalledWith('peer-abc');
    expect(state.pollerFor).toHaveBeenCalledWith(state.machine);
  });

  // Finding 7: before this fix, findSession returned null for every
  // remote request unconditionally, so a launch on a machine already
  // running this worktree's agent always took the `create` branch —
  // a second tmux session and a second agent in the same checkout.
  //
  // `state.existing` is deliberately left `null` here (second-pass
  // finding 5): the match must come from `listOurSessionsWith`'s own
  // resolved array, not from the mock's local-fallback branch — a
  // regression that made `findSession` resolve this remote request
  // against `undefined` (local tmux) instead of that array would make
  // `resolveWorktreeSession`'s mock fall into its `sessions === undefined`
  // branch and still return `state.existing`, unless that variable is
  // left unset here.
  it('attaches to an existing session found on the machine, rather than creating a duplicate (finding 7)', async () => {
    const remoteExisting: TaggedSession = { ...found, machine: 'peer-abc' };
    state.listOurSessionsWith.mockResolvedValue([remoteExisting]);
    await openSession({
      ...base,
      session: {
        type: 'worktree',
        repo: '/repo',
        branch: 'feature/x',
        machine: 'peer-abc',
      },
    });
    expect(state.listOurSessionsWith).toHaveBeenCalledWith(
      (state.machine as { executor: unknown }).executor,
      'peer-abc'
    );
    expect(state.createRemote.mock.calls[0][1]).toMatchObject({
      mode: 'attach',
      target: found.name,
    });
    expect(state.createRemote).toHaveBeenCalledOnce();
  });

  it('creates fresh when the remote machine’s own listing finds nothing for this repo/branch', async () => {
    // state.existing stays null (the remote listing's default in this
    // suite) — discovery is still consulted (asserted below), it
    // simply finds nothing, which must still create rather than throw.
    await openSession({
      ...base,
      session: {
        type: 'worktree',
        repo: '/repo',
        branch: 'feature/x',
        machine: 'peer-abc',
      },
    });
    expect(state.listOurSessionsWith).toHaveBeenCalledWith(
      (state.machine as { executor: unknown }).executor,
      'peer-abc'
    );
    expect(state.createRemote.mock.calls[0][1]).toMatchObject({
      mode: 'create',
    });
  });

  it('registers the spawned remote session under a key carrying the machine (D2)', async () => {
    await openSession({
      ...base,
      session: {
        type: 'worktree',
        repo: '/repo',
        branch: 'feature/x',
        machine: 'peer-abc',
      },
    });
    expect(state.register).toHaveBeenCalledWith(
      '["worktree","/repo","feature/x","peer-abc"]',
      expect.anything(),
      80,
      24,
      'codex'
    );
  });

  it('does not coalesce a local and a remote request for the same repo/branch', async () => {
    const local = openSession(base);
    const remote = openSession({
      ...base,
      session: {
        type: 'worktree',
        repo: '/repo',
        branch: 'feature/x',
        machine: 'peer-abc',
      },
    });
    await Promise.all([local, remote]);
    expect(state.create).toHaveBeenCalledOnce();
    expect(state.createRemote).toHaveBeenCalledOnce();
  });

  it('a machine that cannot be resolved fails loudly rather than launching locally', async () => {
    state.requireMachine.mockImplementationOnce(() => {
      throw new Error('Machine "peer-abc" is not available');
    });
    await expect(
      openSession({
        ...base,
        session: {
          type: 'worktree',
          repo: '/repo',
          branch: 'feature/x',
          machine: 'peer-abc',
        },
      })
    ).rejects.toThrow('is not available');
    expect(state.create).not.toHaveBeenCalled();
    expect(state.register).not.toHaveBeenCalled();
  });
});
