import { worktreeSessionKey } from '../session-key.js';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type {
  AppConfig,
  PullRequestComments,
  PullRequestInfo,
  VcsProvider,
} from '@n10/vcs-core';
import type { BabysitStatus } from './babysit-model.js';
import type { PullRequestLookup } from '../pull-requests/pull-request-cache.js';

const mocks = vi.hoisted(() => ({
  fetchRefs:
    vi.fn<
      (req: {
        cwd: string;
        refs: readonly string[] | 'all';
        maxAgeMs?: number;
      }) => Promise<boolean>
    >(),
  countConflictsBetween:
    vi.fn<
      (base: string, head: string, cwd?: string) => Promise<number | null>
    >(),
  refExists: vi.fn<(ref: string, cwd?: string) => Promise<boolean>>(),
  checkoutWorktree:
    vi.fn<(branch: string, cwd?: string) => Promise<string | null>>(),
  isSessionAlive: vi.fn<() => boolean>(),
  idleFor: vi.fn<() => number>(),
  deliverToRunningSession: vi.fn<(name: string, prompt: string) => boolean>(),
  launchSession: vi.fn(),
}));

vi.mock('@n10/logger', () => ({ logError: () => undefined }));
// No `createWorktree` here on purpose: the babysitter must never reach
// the variant that invents a branch, and an import of it would fail
// loudly rather than pass through a stub.
vi.mock('@n10/worktree-manager', () => ({
  branchToSessionName: (b: string) => b.replace(/\//g, '-'),
  countConflictsBetween: (base: string, head: string, cwd?: string) =>
    mocks.countConflictsBetween(base, head, cwd),
  refExists: (ref: string, cwd?: string) => mocks.refExists(ref, cwd),
  checkoutWorktree: (branch: string, cwd?: string) =>
    mocks.checkoutWorktree(branch, cwd),
  // The checkout the PR's branch is in, which keys its agent session.
  listWorktrees: () =>
    Promise.resolve([{ branch: 'feat/thing', path: '/wt/feat-thing' }]),
}));
// The fetch line is shared with the sync pass; here it is the fetch.
vi.mock('../sync/fetch-queue.js', () => ({
  fetchRefs: (req: Parameters<typeof mocks.fetchRefs>[0]) =>
    mocks.fetchRefs(req),
}));
vi.mock('../pty-registry.js', () => ({
  isSessionAlive: () => mocks.isSessionAlive(),
}));
vi.mock('../activity.js', () => ({ idleFor: () => mocks.idleFor() }));
vi.mock('../session/launch-session.js', () => ({
  deliverToRunningSession: (name: string, prompt: string) =>
    mocks.deliverToRunningSession(name, prompt),
  launchSession: (params: unknown) => mocks.launchSession(params),
}));

const { startPrBabysitter, babysitTimingFromEnv } = await import(
  './pr-babysitter.js'
);
const { observePullRequest } = await import('./babysit-observe.js');

const MIN = 60_000;

const pr: PullRequestInfo = {
  id: 7,
  title: 'Add thing',
  sourceBranch: 'feat/thing',
  targetBranch: 'master',
  url: 'https://x/7',
  createdByIdentifier: 'me',
  createdByDisplayName: 'Me',
  buildStatus: 'succeeded',
  headSha: 'abc',
};

const config = {
  vendorAuth: {},
  vendorProject: { username: 'me' },
} as AppConfig;

function providerWith(comments: PullRequestComments): VcsProvider {
  return {
    matchesUser: (id: string) => id === 'me',
    fetchCommentThreads: vi.fn(() => Promise.resolve(comments)),
  } as unknown as VcsProvider;
}

const noComments: PullRequestComments = { threads: [], generalComments: [] };

/** An observation of `pr` in `/repo` at t=0, with the given overrides. */
function observing(
  over: Partial<Parameters<typeof observePullRequest>[0]>
): Parameters<typeof observePullRequest>[0] {
  return {
    pr,
    provider: null,
    config,
    cwd: '/repo',
    previous: null,
    now: 0,
    ...over,
  };
}

const aliceThread = {
  id: 't1',
  file: 'a.ts',
  lineStart: 1,
  lineEnd: 1,
  side: 'RIGHT' as const,
  isResolved: false,
  isOutdated: false,
  canResolve: true,
  comments: [{ id: 'c', author: 'alice', body: 'fix', createdAt: '' }],
};

describe('observePullRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchRefs.mockResolvedValue(true);
    mocks.countConflictsBetween.mockResolvedValue(2);
  });

  it('keeps unresolved inline and general threads, drops resolved ones', async () => {
    const provider = providerWith({
      threads: [aliceThread, { ...aliceThread, id: 't2', isResolved: true }],
      generalComments: [
        { ...aliceThread, id: 'g1', file: null, lineStart: null },
      ],
    });
    const result = await observePullRequest(observing({ provider }));
    const observation = result?.observation;
    expect(observation?.threads.map((t) => t.id)).toEqual(['t1', 'g1']);
    expect(observation).toMatchObject({
      buildStatus: 'succeeded',
      headSha: 'abc',
      conflictCount: 2,
    });
  });

  it('reports the conflict check as not run when the fetch failed', async () => {
    mocks.fetchRefs.mockResolvedValue(false);
    const result = await observePullRequest(observing({ provider: null }));
    expect(result?.observation.conflictCount).toBeNull();
    expect(mocks.countConflictsBetween).not.toHaveBeenCalled();
  });

  it('reuses the thread list and skips the fetch until the refresh is due', async () => {
    const provider = providerWith({
      threads: [aliceThread],
      generalComments: [],
    });
    const first = await observePullRequest(observing({ provider }));
    const second = await observePullRequest(
      observing({ provider, previous: first?.remote, now: MIN })
    );
    expect(second?.observation.threads).toBe(first?.observation.threads);
    expect(provider.fetchCommentThreads).toHaveBeenCalledTimes(1);
    expect(mocks.fetchRefs).toHaveBeenCalledTimes(1);
    // The merge check itself still runs against the tracking refs.
    expect(mocks.countConflictsBetween).toHaveBeenCalledTimes(2);
  });

  it('reads again early when the list shows the count or the head moved', async () => {
    const provider = providerWith(noComments);
    const first = await observePullRequest(observing({ provider }));
    await observePullRequest(
      observing({
        pr: { ...pr, activeCommentCount: 1 },
        provider,
        previous: first?.remote,
        now: MIN,
      })
    );
    await observePullRequest(
      observing({
        pr: { ...pr, headSha: 'def' },
        provider,
        previous: first?.remote,
        now: MIN,
      })
    );
    expect(provider.fetchCommentThreads).toHaveBeenCalledTimes(3);
  });

  it('reads again once the refresh interval has passed', async () => {
    const provider = providerWith(noComments);
    const first = await observePullRequest(observing({ provider }));
    await observePullRequest(
      observing({ provider, previous: first?.remote, now: 5 * MIN })
    );
    expect(provider.fetchCommentThreads).toHaveBeenCalledTimes(2);
  });

  it('names the repository in every git call, and fetches through the shared line', async () => {
    await observePullRequest(observing({ provider: null }));
    // A fetch of the same refs younger than the refresh interval is
    // reused rather than repeated.
    expect(mocks.fetchRefs).toHaveBeenCalledWith({
      cwd: '/repo',
      refs: ['master', 'feat/thing'],
      maxAgeMs: 5 * MIN,
    });
    expect(mocks.countConflictsBetween).toHaveBeenCalledWith(
      'origin/master',
      'origin/feat/thing',
      '/repo'
    );
  });

  it('fetches rather than reuses when the head moved', async () => {
    const first = await observePullRequest(observing({ provider: null }));
    await observePullRequest(
      observing({
        provider: null,
        pr: { ...pr, headSha: 'def' },
        previous: first?.remote ?? null,
        now: MIN,
      })
    );
    expect(mocks.fetchRefs).toHaveBeenLastCalledWith(
      expect.objectContaining({ maxAgeMs: 0 })
    );
  });

  /**
   * The desktop switches repositories with `chdir`, and a poll
   * straddles several awaits. Once the watch is no longer live, no
   * git runs — not in the wrong repository, not at all.
   */
  it('runs no git once the watch stops being live between its steps', async () => {
    let live = true;
    const provider = {
      matchesUser: () => false,
      fetchCommentThreads: () => {
        live = false;
        return Promise.resolve(noComments);
      },
    } as unknown as VcsProvider;
    const abandoned = await observePullRequest(
      observing({ provider, live: () => live })
    );
    expect(abandoned).toBeNull();
    expect(mocks.fetchRefs).not.toHaveBeenCalled();
    expect(mocks.countConflictsBetween).not.toHaveBeenCalled();

    live = true;
    mocks.fetchRefs.mockImplementation(() => {
      live = false;
      return Promise.resolve(true);
    });
    const abandonedLater = await observePullRequest(
      observing({ provider: null, live: () => live })
    );
    expect(abandonedLater).toBeNull();
    expect(mocks.countConflictsBetween).not.toHaveBeenCalled();
  });
});

describe('startPrBabysitter', () => {
  let clock = 0;
  const statuses: BabysitStatus[] = [];
  let lookup: () => Promise<PullRequestLookup>;
  const failing = { ...pr, buildStatus: 'failed' as const };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    clock = 0;
    statuses.length = 0;
    mocks.fetchRefs.mockResolvedValue(true);
    mocks.countConflictsBetween.mockResolvedValue(0);
    mocks.refExists.mockResolvedValue(true);
    mocks.checkoutWorktree.mockResolvedValue('/wt/feat-thing');
    mocks.isSessionAlive.mockReturnValue(true);
    mocks.idleFor.mockReturnValue(60_000);
    mocks.deliverToRunningSession.mockReturnValue(true);
    lookup = () => Promise.resolve({ kind: 'found', pr: failing });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function start(over: Partial<Parameters<typeof startPrBabysitter>[0]> = {}) {
    return startPrBabysitter({
      pr,
      cwd: '/repo',
      getProvider: () => providerWith(noComments),
      getConfig: () => config,
      readPullRequest: () => lookup(),
      paneSize: () => ({ cols: 100, rows: 30 }),
      onStatus: (s) => statuses.push(s),
      now: () => clock,
      intervalMs: MIN,
      ...over,
    });
  }

  /** Poll once at t=0 and once past the debounce. */
  async function pollPastDebounce(sitter: { pollNow: () => Promise<void> }) {
    await sitter.pollNow();
    clock = 10 * MIN;
    await sitter.pollNow();
  }

  it('waits out the debounce before typing the update into an idle agent', async () => {
    const sitter = start();
    await sitter.pollNow();
    expect(statuses.at(-1)).toMatchObject({
      phase: 'pending',
      pendingSince: 0,
    });
    expect(mocks.deliverToRunningSession).not.toHaveBeenCalled();

    clock = 10 * MIN;
    await sitter.pollNow();
    expect(mocks.deliverToRunningSession).toHaveBeenCalledWith(
      worktreeSessionKey('/wt/feat-thing', '/repo'),
      expect.stringContaining('CI: failed')
    );
    expect(statuses.at(-1)).toMatchObject({
      phase: 'watching',
      held: null,
      deliveries: 1,
      lastDeliveredAt: 10 * MIN,
    });
    sitter.stop();
  });

  it('holds the update while the agent has produced output recently', async () => {
    mocks.idleFor.mockReturnValue(5_000);
    const sitter = start();
    await pollPastDebounce(sitter);
    expect(mocks.deliverToRunningSession).not.toHaveBeenCalled();
    expect(statuses.at(-1)).toMatchObject({
      phase: 'pending',
      held: 'agent-busy',
    });

    mocks.idleFor.mockReturnValue(60_000);
    clock = 11 * MIN;
    await sitter.pollNow();
    expect(mocks.deliverToRunningSession).toHaveBeenCalledTimes(1);
    expect(statuses.at(-1)?.held).toBeNull();
    sitter.stop();
  });

  it('drops the hold once the news resolves itself', async () => {
    mocks.idleFor.mockReturnValue(5_000);
    const sitter = start();
    await pollPastDebounce(sitter);
    expect(statuses.at(-1)?.held).toBe('agent-busy');
    // CI went green on its own while the update was held.
    lookup = () => Promise.resolve({ kind: 'found', pr });
    clock = 11 * MIN;
    await sitter.pollNow();
    expect(statuses.at(-1)).toMatchObject({ phase: 'watching', held: null });
    sitter.stop();
  });

  it('never types into a session that belongs to another repository', async () => {
    const sitter = start({
      isForeignSession: (name) =>
        name === worktreeSessionKey('/wt/feat-thing', '/repo'),
    });
    await pollPastDebounce(sitter);
    expect(mocks.deliverToRunningSession).not.toHaveBeenCalled();
    expect(mocks.launchSession).not.toHaveBeenCalled();
    expect(statuses.at(-1)?.held).toBe('foreign-session');
    sitter.stop();
  });

  it('starts an agent seeded with the update when none is running', async () => {
    mocks.isSessionAlive.mockReturnValue(false);
    const spawned: string[] = [];
    const sitter = start({
      onSpawned: (name, cwd) => spawned.push(`${name}@${cwd}`),
    });
    await pollPastDebounce(sitter);
    expect(mocks.launchSession).toHaveBeenCalledWith(
      expect.objectContaining({
        name: worktreeSessionKey('/wt/feat-thing', '/repo'),
        cwd: '/wt/feat-thing',
        cols: 100,
        rows: 30,
        request: {
          intent: 'seed',
          prompt: expect.stringContaining('Status update for PR #7'),
        },
      })
    );
    expect(spawned).toEqual([
      `${worktreeSessionKey('/wt/feat-thing', '/repo')}@/wt/feat-thing`,
    ]);
    expect(statuses.at(-1)?.deliveries).toBe(1);
    sitter.stop();
  });

  it('checks the branch out in the pull request’s repository, whatever the process directory', async () => {
    mocks.isSessionAlive.mockReturnValue(false);
    const sitter = start();
    await pollPastDebounce(sitter);
    expect(mocks.refExists).toHaveBeenCalledWith('feat/thing', '/repo');
    expect(mocks.checkoutWorktree).toHaveBeenCalledWith('feat/thing', '/repo');
    sitter.stop();
  });

  it('does not invent a branch that exists neither locally nor on origin', async () => {
    mocks.isSessionAlive.mockReturnValue(false);
    mocks.refExists.mockResolvedValue(false);
    const sitter = start();
    await pollPastDebounce(sitter);
    expect(mocks.checkoutWorktree).not.toHaveBeenCalled();
    expect(mocks.launchSession).not.toHaveBeenCalled();
    expect(statuses.at(-1)?.held).toBe('branch-unavailable');
    sitter.stop();
  });

  it('reports a checkout git refused, and leaves the update pending', async () => {
    mocks.isSessionAlive.mockReturnValue(false);
    mocks.checkoutWorktree.mockResolvedValue(null);
    const sitter = start();
    await pollPastDebounce(sitter);
    expect(mocks.launchSession).not.toHaveBeenCalled();
    expect(statuses.at(-1)).toMatchObject({
      phase: 'pending',
      lastError: 'Could not create the worktree',
    });
    sitter.stop();
  });

  it('keeps the update pending when delivery fails', async () => {
    mocks.deliverToRunningSession.mockReturnValue(false);
    const sitter = start();
    await pollPastDebounce(sitter);
    expect(statuses.at(-1)).toMatchObject({
      phase: 'pending',
      deliveries: 0,
      lastError: 'The agent exited while being briefed',
    });
    mocks.deliverToRunningSession.mockReturnValue(true);
    clock = 11 * MIN;
    await sitter.pollNow();
    expect(statuses.at(-1)).toMatchObject({ deliveries: 1, lastError: null });
    sitter.stop();
  });

  it('does not spawn when the repo moved during the checkout', async () => {
    mocks.isSessionAlive.mockReturnValue(false);
    let current = true;
    const sitter = start({ isCurrent: () => current });
    mocks.checkoutWorktree.mockImplementation(() => {
      current = false;
      return Promise.resolve('/wt/feat-thing');
    });
    await pollPastDebounce(sitter);
    expect(mocks.launchSession).not.toHaveBeenCalled();
    expect(statuses.at(-1)?.held).toBe('interrupted');
    sitter.stop();
  });

  it('does not check anything out when the repo moved during the branch check', async () => {
    mocks.isSessionAlive.mockReturnValue(false);
    let current = true;
    const sitter = start({ isCurrent: () => current });
    mocks.refExists.mockImplementation(() => {
      current = false;
      return Promise.resolve(true);
    });
    await pollPastDebounce(sitter);
    expect(mocks.checkoutWorktree).not.toHaveBeenCalled();
    sitter.stop();
  });

  it('abandons a poll when the repository changes between its steps', async () => {
    let current = true;
    lookup = () => {
      current = false;
      return Promise.resolve({ kind: 'found', pr: failing });
    };
    const sitter = start({ isCurrent: () => current });
    await sitter.pollNow();
    expect(mocks.fetchRefs).not.toHaveBeenCalled();
    expect(statuses).toEqual([]);
    sitter.stop();
  });

  it('abandons a poll when the repository changes mid-observation, running no more git', async () => {
    let current = true;
    mocks.fetchRefs.mockImplementation(() => {
      current = false;
      return Promise.resolve(true);
    });
    const sitter = start({ isCurrent: () => current });
    await sitter.pollNow();
    expect(mocks.countConflictsBetween).not.toHaveBeenCalled();
    expect(statuses).toEqual([]);
    sitter.stop();
  });

  it('ends when the pull request is gone twice running, but not when the provider could not say', async () => {
    lookup = () => Promise.resolve({ kind: 'unknown', reason: 'offline' });
    const sitter = start();
    await sitter.pollNow();
    expect(statuses.at(-1)).toMatchObject({
      phase: 'watching',
      lastError: 'offline',
    });

    lookup = () => Promise.resolve({ kind: 'gone' });
    await sitter.pollNow();
    await sitter.pollNow();
    expect(statuses.at(-1)?.phase).toBe('ended');
    lookup = () => Promise.resolve({ kind: 'found', pr });
    await vi.advanceTimersByTimeAsync(3 * MIN);
    expect(statuses.filter((s) => s.phase === 'ended')).toHaveLength(1);
  });

  it('shrugs off a single absence: the list is an eventually consistent search', async () => {
    const sitter = start();
    await sitter.pollNow();
    lookup = () => Promise.resolve({ kind: 'gone' });
    await sitter.pollNow();
    expect(sitter.status()).toMatchObject({
      phase: 'pending',
      lastError: null,
    });
    // Back in the next list: nothing ended, nothing to report, and the
    // count starts over — a later absence is a first one again.
    lookup = () => Promise.resolve({ kind: 'found', pr: failing });
    await sitter.pollNow();
    lookup = () => Promise.resolve({ kind: 'gone' });
    await sitter.pollNow();
    expect(sitter.status().phase).toBe('pending');
    expect(statuses.some((s) => s.phase === 'ended')).toBe(false);
    sitter.stop();
  });

  it('reads the provider per poll, so a vendor switch takes effect', async () => {
    const providers = [providerWith(noComments), providerWith(noComments)];
    let which = 0;
    const sitter = start({ getProvider: () => providers[which] });
    await sitter.pollNow();
    which = 1;
    clock = 5 * MIN;
    await sitter.pollNow();
    expect(providers[0].fetchCommentThreads).toHaveBeenCalledTimes(1);
    expect(providers[1].fetchCommentThreads).toHaveBeenCalledTimes(1);
    sitter.stop();
  });

  it('takes its cadence from the environment when the caller sets none', async () => {
    expect(
      babysitTimingFromEnv({
        N10_BABYSIT_POLL_MS: '1000',
        N10_BABYSIT_DEBOUNCE_MS: '500',
      })
    ).toEqual({ intervalMs: 1000, timing: { debounceMs: 500 } });
    expect(babysitTimingFromEnv({ N10_BABYSIT_POLL_MS: 'soon' })).toEqual({
      intervalMs: undefined,
      timing: undefined,
    });

    vi.stubEnv('N10_BABYSIT_DEBOUNCE_MS', '500');
    try {
      const sitter = start();
      await sitter.pollNow();
      clock = 600;
      await sitter.pollNow();
      // Delivered after half a second, not the ten minutes of the model.
      expect(mocks.deliverToRunningSession).toHaveBeenCalledTimes(1);
      sitter.stop();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('skips a poll that throws and reports the error', async () => {
    lookup = () => Promise.reject(new Error('gh: rate limited'));
    const sitter = start();
    await sitter.pollNow();
    expect(statuses.at(-1)).toMatchObject({
      lastError: 'gh: rate limited',
      lastPolledAt: null,
    });
    sitter.stop();
  });

  it('polls on its own on the interval and stops when told', async () => {
    let polls = 0;
    lookup = () => {
      polls += 1;
      return Promise.resolve({ kind: 'found', pr: failing });
    };
    const sitter = start();
    await vi.advanceTimersByTimeAsync(MIN + 1);
    expect(polls).toBeGreaterThanOrEqual(2);
    const before = polls;
    sitter.stop();
    await vi.advanceTimersByTimeAsync(5 * MIN);
    expect(polls).toBe(before);
  });

  it('reports transitions, not every poll', async () => {
    // A poll that leaves the phase, the hold, the delivery count and
    // the error where they were moves only `lastPolledAt`, which the
    // status still carries but nobody is told about — a shell would
    // otherwise repaint once a minute per watched row.
    const sitter = start();
    await sitter.pollNow();
    expect(statuses.map((s) => s.phase)).toEqual(['pending']);
    clock = MIN;
    await sitter.pollNow();
    clock = 2 * MIN;
    await sitter.pollNow();
    expect(statuses).toHaveLength(1);
    expect(sitter.status().lastPolledAt).toBe(2 * MIN);

    clock = 10 * MIN;
    await sitter.pollNow();
    expect(statuses.map((s) => s.phase)).toEqual(['pending', 'watching']);
    clock = 11 * MIN;
    await sitter.pollNow();
    expect(statuses).toHaveLength(2);
    sitter.stop();
  });
});
