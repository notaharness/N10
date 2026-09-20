import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@n10/vcs-core';
import { ORCHESTRA_TAG, type TaggedSession } from '../session-identity.js';

const state = vi.hoisted(() => ({
  sessions: [] as TaggedSession[],
  create: vi.fn<(spec: unknown, plan: unknown) => { name: string }>(() => ({
    name: 'repo-feature-x-review',
  })),
  register: vi.fn(),
  held: null as unknown,
  killEntry: vi.fn(),
  killTmux: vi.fn(),
}));

vi.mock('@n10/terminal-tmux', () => ({
  createTmuxBackend: state.create,
  tmuxKillSession: state.killTmux,
}));
vi.mock('../pty-registry.js', () => ({
  spawnSession: state.register,
  sessionNames: () => [],
  getSession: () => state.held,
  killSession: state.killEntry,
}));
vi.mock('../session-resolver.js', () => ({
  listOurSessions: () => state.sessions,
  // openSession resolves a terminal target by its tmux name; answering
  // null here would make every launch look like a first one.
  resolveSessionByName: (name: string) =>
    state.sessions.find((s) => s.name === name) ?? null,
  resolveWorktreeSession: () => null,
}));
vi.mock('../discovery/worktree-origin.js', () => ({
  readWorktreeHead: () => ({ branch: 'feature/x' }),
}));
vi.mock('./machine-env.js', () => ({ machineEnvAdditions: () => ({}) }));

import {
  endReviewSession,
  findReviewSession,
  launchReviewSession,
  listReviewSessions,
} from './launch-review.js';

const config = { vendorAuth: {}, vendorProject: {} } as AppConfig;

function session(over: Partial<TaggedSession>): TaggedSession {
  return {
    name: 'a-session',
    created: 1,
    paneDead: false,
    path: '/repo/wt',
    spawner: 'n10',
    repo: '/repo',
    type: 'agent',
    branch: '',
    ...over,
  };
}

const params = {
  repo: '/repo',
  branch: 'feature/x',
  pullRequest: '42',
  cwd: '/repo/wt',
  cols: 80,
  rows: 24,
  config,
  request: { intent: 'seed' as const, prompt: 'review it' },
};

beforeEach(() => {
  vi.clearAllMocks();
  state.sessions = [];
  state.held = null;
});

describe('finding a review', () => {
  it('reads the review tag, never the name', () => {
    const review = session({ name: 'anything-at-all', review: '42' });
    state.sessions = [review];
    expect(findReviewSession('/repo', '42')).toBe(review);
  });

  it('does not mistake the branch player for its review', () => {
    // A worktree session is the agent that owns the branch. Tagging it
    // as a review must not make it one.
    state.sessions = [
      session({ type: 'worktree', branch: 'feature/x', review: '42' }),
    ];
    expect(findReviewSession('/repo', '42')).toBeNull();
    expect(listReviewSessions()).toEqual([]);
  });

  it('keeps reviews of different pull requests and repositories apart', () => {
    state.sessions = [
      session({ name: 'other-pr', review: '43' }),
      session({ name: 'other-repo', repo: '/elsewhere', review: '42' }),
    ];
    expect(findReviewSession('/repo', '42')).toBeNull();
  });

  it('leaves an ordinary agent terminal out of the review listing', () => {
    state.sessions = [session({ name: 'repo-agent' })];
    expect(listReviewSessions()).toEqual([]);
  });
});

describe('launching a review', () => {
  it('creates its own session rather than touching the branch player', async () => {
    await launchReviewSession(params);
    const plan = state.create.mock.calls[0][1] as {
      mode: string;
      label: string;
      tags: Record<string, string>;
      retainOnExit: boolean;
    };
    expect(plan.mode).toBe('create');
    expect(plan.label).toBe('repo-feature-x-review');
    expect(plan.tags[ORCHESTRA_TAG.sessionType]).toBe('agent');
    expect(plan.tags[ORCHESTRA_TAG.review]).toBe('42');
    expect(plan.tags[ORCHESTRA_TAG.branch]).toBe('feature/x');
    // The pane outlives the process, so its transcript is still there.
    expect(plan.retainOnExit).toBe(true);
  });

  it('attaches to a live review instead of starting a second', async () => {
    // Asking to review again means "show me the reviewer I have".
    // Nothing kills a running agent to make room for another.
    state.sessions = [session({ name: 'live-review', review: '42' })];
    await launchReviewSession(params);
    expect(state.create.mock.calls[0][1]).toMatchObject({
      mode: 'attach',
      target: 'live-review',
    });
    expect(state.killTmux).not.toHaveBeenCalled();
    expect(state.killEntry).not.toHaveBeenCalled();
  });

  it('restarts a review whose pane has exited, keeping its session', async () => {
    state.sessions = [
      session({ name: 'dead-review', review: '42', paneDead: true }),
    ];
    await launchReviewSession(params);
    expect(state.create.mock.calls[0][1]).toMatchObject({
      mode: 'restart',
      target: 'dead-review',
    });
    expect(state.killTmux).not.toHaveBeenCalled();
  });

  it('leaves a review of another pull request alone', async () => {
    state.sessions = [session({ name: 'other-review', review: '43' })];
    await launchReviewSession(params);
    expect(state.create.mock.calls[0][1]).toMatchObject({ mode: 'create' });
    expect(state.killTmux).not.toHaveBeenCalled();
  });
});

describe('ending a review', () => {
  it('kills the held entry so its tab hears about it', () => {
    state.sessions = [session({ name: 'live-review', review: '42' })];
    state.held = { pty: {} };
    endReviewSession('/repo', '42');
    expect(state.killEntry).toHaveBeenCalledWith('["terminal","live-review"]');
    expect(state.killTmux).not.toHaveBeenCalled();
  });

  it('kills a session left behind by an earlier run', () => {
    state.sessions = [session({ name: 'orphan-review', review: '42' })];
    endReviewSession('/repo', '42');
    expect(state.killTmux).toHaveBeenCalledWith('orphan-review');
  });

  it('does nothing when there is no review to end', () => {
    endReviewSession('/repo', '42');
    expect(state.killTmux).not.toHaveBeenCalled();
    expect(state.killEntry).not.toHaveBeenCalled();
  });
});
