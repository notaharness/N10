import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@n10/vcs-core';
import type { TaggedSession } from '../session-identity.js';

// Exercises the real openSession boundary (unlike launch-terminal.spec.ts,
// which mocks it out) so a regression in forwarding `fresh` from
// launchTerminalSession through to openSession is caught here.
const state = vi.hoisted(() => ({
  existing: null as TaggedSession | null,
  create: vi.fn<(spec: unknown, plan: unknown) => { name: string }>(() => ({
    name: 'allocated',
  })),
  register: vi.fn(),
}));
vi.mock('@n10/terminal-tmux', () => ({ createTmuxBackend: state.create }));
vi.mock('../pty-registry.js', () => ({
  spawnSession: state.register,
  sessionNames: () => [],
}));
vi.mock('../session-resolver.js', () => ({
  resolveSessionByName: () => state.existing,
  resolveWorktreeSession: () => state.existing,
}));
vi.mock('../repo-root.js', () => ({ getRepoRoot: () => '/repo' }));
import { terminalSessionKey } from '../session-key.js';
import { launchTerminalSession } from './launch-terminal.js';

const config = {
  vendorAuth: {},
  vendorProject: {},
  agentId: 'codex',
} as AppConfig;
const base = { cwd: '/repo', cols: 80, rows: 24, config };
const liveAgentPane: TaggedSession = {
  name: 'saved-label',
  repo: '/repo',
  branch: '',
  path: base.cwd,
  type: 'agent',
  spawner: 'orchestra',
  agent: 'codex',
  created: 1,
  paneDead: false,
  machine: 'local',
};

beforeEach(() => {
  vi.clearAllMocks();
  state.existing = null;
});

describe('fresh agent terminal launch against a live pane', () => {
  it('requires confirmation instead of silently attaching', async () => {
    state.existing = liveAgentPane;
    await expect(
      launchTerminalSession({
        ...base,
        kind: 'agent',
        name: terminalSessionKey('saved'),
        fresh: true,
      })
    ).rejects.toThrow('confirmation');
    expect(state.create).not.toHaveBeenCalled();
    expect(state.register).not.toHaveBeenCalled();
  });

  it('attaches without confirmation for a continuing (non-fresh) launch', async () => {
    state.existing = liveAgentPane;
    await launchTerminalSession({
      ...base,
      kind: 'agent',
      name: terminalSessionKey('saved'),
    });
    expect(state.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ mode: 'attach' })
    );
  });
});
