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
}));
vi.mock('@n10/terminal-tmux', () => ({
  createTmuxBackend: state.create,
  createRemoteTmuxBackend: state.createRemote,
}));
vi.mock('../pty-registry.js', () => ({
  spawnSession: state.register,
  sessionNames: () => [],
}));
vi.mock('../session-resolver.js', () => ({
  resolveSessionByName: () => state.existing,
  resolveWorktreeSession: () => state.existing,
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

  it('always creates fresh for a remote request rather than resolving an existing session locally', async () => {
    // Even with a "found" local session for this repo/branch, a remote
    // request must not attach to it — the two live on different
    // machines and a local tmux name means nothing on the remote one.
    state.existing = found;
    await openSession({
      ...base,
      session: {
        type: 'worktree',
        repo: '/repo',
        branch: 'feature/x',
        machine: 'peer-abc',
      },
    });
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
