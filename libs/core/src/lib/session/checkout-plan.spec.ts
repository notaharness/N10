import { worktreeSessionKey } from '../session-key.js';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AppConfig, PullRequestInfo } from '@n10/vcs-core';

// Mock the launcher + registry so the orchestrator's branching is
// observable without spawning real processes.
const hasSession = vi.fn();
const hasLiveTmuxSession = vi.fn();
const hasSessionConnection = vi.fn();
const killPersistedTmuxSession = vi.fn();
const killSession = vi.fn();
vi.mock('../pty-registry.js', () => ({
  hasSession: (n: string) => hasSession(n),
  isSessionAlive: (n: string) => hasSession(n),
  hasSessionConnection: (n: string) => hasSessionConnection(n),
  killSession: (name: string) => killSession(name),
}));

vi.mock('../session-backend.js', () => ({
  hasLiveTmuxSession: (name: string) => hasLiveTmuxSession(name),
  killPersistedTmuxSession: (name: string) => killPersistedTmuxSession(name),
}));

const launchSession = vi.fn();
const deliverToRunningSession = vi.fn();
vi.mock('./launch-session.js', () => ({
  launchSession: (...a: unknown[]) => launchSession(...a),
  deliverToRunningSession: (...a: unknown[]) => deliverToRunningSession(...a),
}));

const branchToSessionName = vi.fn((b: string) => `sess-${b}`);
const createWorktree = vi.fn();
vi.mock('@n10/worktree-manager', () => ({
  branchToSessionName: (b: string) => branchToSessionName(b),
  createWorktree: (b: string) => createWorktree(b),
  // The checkout the PR's branch is in, which keys its session.
  listWorktrees: async () => [{ branch: 'feature/x', path: '/wt/feature-x' }],
}));

import { checkoutPlan } from './checkout-plan.js';

const pr = { id: 7, sourceBranch: 'feature/x' } as PullRequestInfo;
const config = { vendorAuth: {}, vendorProject: {} } as AppConfig;

function deps(mode: 'inject' | 'new-session', flashStatus = vi.fn()) {
  return {
    pr,
    prompt: 'Resolve these PR review comments:\n\n### 1. a.ts:1\n@a: b',
    paneCols: 80,
    paneRows: 24,
    mode,
    config,
    flashStatus,
  };
}

describe('checkoutPlan', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasLiveTmuxSession.mockReturnValue(false);
    hasSessionConnection.mockImplementation((name: string) => hasSession(name));
    createWorktree.mockResolvedValue('/wt/feature-x');
  });

  it('State A / inject: delivers to the running session, never spawns', async () => {
    hasSession.mockReturnValue(true);
    deliverToRunningSession.mockReturnValue(true);

    const result = await checkoutPlan(deps('inject'));

    expect(result).toBe('injected');
    expect(deliverToRunningSession).toHaveBeenCalledWith(
      worktreeSessionKey('/wt/feature-x'),
      expect.stringContaining('Resolve these PR review comments')
    );
    expect(launchSession).not.toHaveBeenCalled();
    expect(createWorktree).not.toHaveBeenCalled();
  });

  it('attaches a persisted live agent before injecting without starting another process', async () => {
    hasSession.mockReturnValue(false);
    hasLiveTmuxSession.mockReturnValue(true);
    deliverToRunningSession.mockReturnValue(true);
    await expect(checkoutPlan(deps('inject'))).resolves.toBe('injected');
    expect(launchSession).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'attach' })
    );
    expect(deliverToRunningSession).toHaveBeenCalledOnce();
    expect(killSession).not.toHaveBeenCalled();
    expect(killPersistedTmuxSession).not.toHaveBeenCalled();
  });

  it('refreshes an exited local entry when Orchestra has already restarted its process', async () => {
    hasSession.mockReturnValue(false);
    hasSessionConnection.mockReturnValue(true);
    hasLiveTmuxSession.mockReturnValue(true);
    deliverToRunningSession.mockReturnValue(true);
    await expect(checkoutPlan(deps('inject'))).resolves.toBe('injected');
    expect(launchSession).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'attach' })
    );
  });

  it('stops a persisted live agent before starting a requested fresh plan session', async () => {
    hasSession.mockReturnValue(false);
    hasLiveTmuxSession.mockReturnValue(true);
    await expect(checkoutPlan(deps('new-session'))).resolves.toBe('spawned');
    expect(killPersistedTmuxSession).toHaveBeenCalledWith(
      worktreeSessionKey('/wt/feature-x')
    );
    expect(killPersistedTmuxSession.mock.invocationCallOrder[0]).toBeLessThan(
      launchSession.mock.invocationCallOrder[0]
    );
  });

  it('State A / inject: fails when the session is no longer alive', async () => {
    hasSession.mockReturnValue(true);
    deliverToRunningSession.mockReturnValue(false);
    const flash = vi.fn();

    const result = await checkoutPlan(deps('inject', flash));

    expect(result).toBe('failed');
    expect(launchSession).not.toHaveBeenCalled();
    expect(flash).toHaveBeenCalled();
  });

  it('State A / new-session: respawns in the existing worktree with the seed intent', async () => {
    hasSession.mockReturnValue(true);

    const result = await checkoutPlan(deps('new-session'));

    expect(result).toBe('spawned');
    expect(createWorktree).toHaveBeenCalledWith('feature/x');
    expect(launchSession).toHaveBeenCalledTimes(1);
    const arg = launchSession.mock.calls[0][0];
    expect(arg.name).toBe(worktreeSessionKey('/wt/feature-x'));
    expect(arg.cwd).toBe('/wt/feature-x');
    // Must seed (deliver the plan), never continue.
    expect(arg.request).toEqual({
      intent: 'seed',
      prompt: expect.stringContaining('Resolve these PR review comments'),
    });
  });

  it('States B/C: no running agent → create worktree + spawn', async () => {
    hasSession.mockReturnValue(false);

    const result = await checkoutPlan(deps('new-session'));

    expect(result).toBe('spawned');
    expect(createWorktree).toHaveBeenCalledWith('feature/x');
    expect(launchSession).toHaveBeenCalledTimes(1);
    expect(launchSession.mock.calls[0][0].cwd).toBe('/wt/feature-x');
  });

  it('fails when the worktree cannot be created', async () => {
    hasSession.mockReturnValue(false);
    createWorktree.mockResolvedValue(null);
    const flash = vi.fn();

    const result = await checkoutPlan(deps('new-session', flash));

    expect(result).toBe('failed');
    expect(launchSession).not.toHaveBeenCalled();
    expect(flash).toHaveBeenCalled();
  });

  it('passes the prompt through verbatim — no quote stripping', async () => {
    hasSession.mockReturnValue(false);

    await checkoutPlan({ ...deps('new-session'), prompt: `it's "quoted"` });

    expect(launchSession.mock.calls[0][0].request.prompt).toBe(`it's "quoted"`);
  });
});
