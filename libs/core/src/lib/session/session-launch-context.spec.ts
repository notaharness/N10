import { beforeEach, expect, it, vi } from 'vitest';
import { worktreeSessionKey } from '../session-key.js';
const state = vi.hoisted(() => ({ agent: 'claude', dead: true, exists: true }));
vi.mock('../session-resolver.js', () => ({
  resolveWorktreeSession: () => ({ name: 'player' }),
}));
vi.mock('@n10/terminal-tmux', () => ({
  tmuxSessionSnapshot: () =>
    state.exists
      ? {
          name: 'player',
          created: 1,
          paneDead: state.dead,
          path: '/repo/worktree',
          incarnation: {
            name: 'player',
            sessionId: '$0',
            paneId: '%0',
            panePid: 22,
            serverPid: 11,
          },
          options: {
            '@orchestra-spawner': 'orchestra',
            '@orchestra-repo': '/repo',
            '@orchestra-branch': 'feature',
            '@orchestra-session-type': 'worktree',
            '@orchestra-agent': state.agent,
            '@orchestra-orchestrator': 'tmux:boss',
            '@orchestra-last-report': 'PROGRESS 2026-01-01T00:00:00Z',
          },
        }
      : null,
}));
import { getSessionLaunchContext } from './session-launch-context.js';
const config = {
  agentId: 'claude' as const,
  aiCommand: 'custom',
  vendorAuth: {},
  vendorProject: {},
};
beforeEach(() => {
  state.agent = 'claude';
  state.dead = true;
  state.exists = true;
});
it.each(['test', '', 'unknown', 'gemini'])(
  'does not promise continuation for a stopped %s agent',
  (agent) => {
    state.agent = agent;
    expect(
      getSessionLaunchContext(
        worktreeSessionKey('/repo/worktree', '/repo'),
        config
      )
    ).toMatchObject({ exists: true, running: false, canResume: false });
  }
);
it('reads named resume capability and reporting details from the native snapshot', () => {
  expect(
    getSessionLaunchContext(
      worktreeSessionKey('/repo/worktree', '/repo'),
      config
    )
  ).toMatchObject({
    canResume: true,
    recordedAgent: 'claude',
    recordedAgentName: 'Claude',
    orchestrator: 'tmux:boss',
    lastReport: { kind: 'PROGRESS', timestamp: '2026-01-01T00:00:00Z' },
  });
});
it('treats a vanished native target as absent', () => {
  state.exists = false;
  expect(
    getSessionLaunchContext(
      worktreeSessionKey('/repo/worktree', '/repo'),
      config
    )
  ).toEqual({ exists: false, running: false, canResume: false });
});
