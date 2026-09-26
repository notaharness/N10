import { worktreeSessionKey } from '@n10/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as SidebarModule from './sidebar.js';
import type * as PullRequestsModule from './pull-requests.js';
import type * as Core from '@n10/core';

/**
 * The renderer polls the sidebar model continuously; the pull request
 * list behind it comes from `@n10/core`'s per-repository cache,
 * whose semantics (TTL, joining, retiring, eviction, credentials) are
 * its own spec's. What is asserted here is the sidebar's use of it:
 * that the model never waits for the provider, that a landed fetch is
 * announced, what the sync state reports for the open repository, and
 * what a refresh tells the provider.
 */

interface Worktree {
  branch?: string;
  path: string;
  state?: string;
}

/** A checkout of `branch` in `repo`, as git would list it. */
function checkout(branch: string, repo = '/repo-a', state?: string): Worktree {
  return {
    branch,
    path: `${repo}/.claude/worktrees/${branch}`,
    ...(state ? { state } : {}),
  };
}

const env = vi.hoisted(() => ({
  cwd: '/repo-a',
  config: {} as Record<string, unknown>,
  configured: true,
  worktrees: [] as Worktree[],
  /** When set, the next worktree listing waits until it is called. */
  releaseWorktrees: null as ((list?: Worktree[]) => void) | null,
  holdWorktrees: false,
  /** Resolvers for each provider fetch, in call order. */
  pending: [] as {
    resolve: (v: Record<string, unknown>) => void;
    reject: (e: Error) => void;
  }[],
  fetchCount: 0,
  forgetCount: 0,
  now: 1_000_000,
  /** Last sessionBranchMap handed to buildSidebarItems. */
  lastBranchMap: new Map<string, string>(),
  /** Last babysat map handed to buildSidebarItems. */
  lastBabysat: null as ReadonlyMap<number, unknown> | null,
  /** cwd → babysit statuses the babysit service answers with. */
  babysat: new Map<string, Map<number, unknown>>(),
}));

vi.mock('./repo.js', () => ({
  requireRepo: () => env.cwd,
  activeRepoIs: (cwd: string) => cwd === env.cwd,
  PROVIDERS: [
    {
      id: 'github',
      isConfigured: () => env.configured,
      forgetPullRequestCache: () => {
        env.forgetCount += 1;
      },
      fetchPullRequests: () => {
        env.fetchCount += 1;
        return new Promise((resolve, reject) => {
          env.pending.push({
            resolve: resolve as (v: Record<string, unknown>) => void,
            reject,
          });
        });
      },
    },
  ],
}));

vi.mock('./babysit.js', () => ({
  babysatStatuses: (cwd: string) => env.babysat.get(cwd) ?? new Map(),
}));

vi.mock('./remote-sync.js', () => ({
  getSyncDecorations: () => ({
    merged: new Set<string>(),
    conflicts: new Map<string, number>(),
    lastGitSyncAt: 42,
  }),
}));

vi.mock('@n10/vcs-core', () => ({
  readConfig: () => ({ vendor: 'github', ...env.config }),
}));

vi.mock('@n10/worktree-manager', () => ({
  listWorktrees: () =>
    env.holdWorktrees
      ? new Promise<typeof env.worktrees>((resolve) => {
          env.holdWorktrees = false;
          env.releaseWorktrees = (list) => resolve(list ?? env.worktrees);
        })
      : Promise.resolve(env.worktrees),
  worktreeSessionName: (wt: { branch?: string }) =>
    (wt.branch ?? 'detached').replace(/\//g, '-'),
}));

vi.mock('@n10/core', async (importOriginal) => ({
  // The cache is the real one: this spec is about what the sidebar
  // does with it, and a fake would only prove the fake.
  ...(await importOriginal<typeof Core>()),
  isSessionAlive: () => false,
  findOrphanPrs: () => [],
  categorizeReviews: () => ({
    needsReview: [],
    waitingForAuthor: [],
    approvedByYou: [],
  }),
  sortSessionsByPrId: (sessions: unknown[]) => sessions,
  buildSidebarItems: (
    sessions: unknown[],
    _orphans: unknown,
    _reviews: unknown,
    sessionBranchMap: Map<string, string>,
    _sessionPrMap: unknown,
    _merged: unknown,
    _conflicts: unknown,
    babysat: ReadonlyMap<number, unknown>
  ) => {
    env.lastBranchMap = sessionBranchMap;
    env.lastBabysat = babysat;
    return sessions;
  },
}));

let sidebar: typeof SidebarModule;
let pullRequests: typeof PullRequestsModule;

/** Settle the promise chain without advancing the clock. */
async function flush(times = 4) {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

beforeEach(async () => {
  env.cwd = '/repo-a';
  env.config = {};
  env.configured = true;
  env.worktrees = [];
  env.holdWorktrees = false;
  env.releaseWorktrees = null;
  env.pending = [];
  env.fetchCount = 0;
  env.forgetCount = 0;
  env.now = 1_000_000;
  env.lastBranchMap = new Map();
  env.lastBabysat = null;
  env.babysat = new Map();

  vi.spyOn(Date, 'now').mockImplementation(() => env.now);
  vi.resetModules();
  sidebar = await import('./sidebar.js');
  pullRequests = await import('./pull-requests.js');
});

/** Resolve the nth outstanding provider fetch. */
function settle(index = 0, value: Record<string, unknown> = {}) {
  env.pending[index].resolve(value);
}

describe('sync state', () => {
  it('reports the cache’s answer for the open repository', async () => {
    const first = sidebar.refreshRemote();
    await flush();
    settle(0);
    await first;
    expect(sidebar.getSyncState()).toMatchObject({
      providerId: 'github',
      providerConfigured: true,
      lastRemoteSyncAt: 1_000_000,
      lastGitSyncAt: 42,
      remoteError: null,
      remoteSyncing: false,
      remoteIntervalMs: 60_000,
      remoteFetches: 1,
    });

    env.cwd = '/repo-b';
    // The cached timestamp belongs to the other checkout; reporting it
    // here would claim this repo had just synced.
    expect(sidebar.getSyncState().lastRemoteSyncAt).toBeNull();
  });

  it('reports the interval the config sets', () => {
    env.config = { prPollInterval: 5_000 };
    expect(sidebar.getSyncState().remoteIntervalMs).toBe(5_000);
  });

  it('does not call the provider at all when it is not configured', async () => {
    env.configured = false;
    await sidebar.listSidebarItems();
    expect(env.fetchCount).toBe(0);
    expect(sidebar.getSyncState().providerConfigured).toBe(false);
  });

  it('reports the failure the cache recorded', async () => {
    const bad = sidebar.refreshRemote();
    await flush();
    env.pending[0].reject(new Error('provider exploded'));
    await bad;
    expect(sidebar.getSyncState().remoteError).toBe('provider exploded');
  });
});

/**
 * A provider may hold per-row answers well past one response — Azure
 * remembers a settled CI verdict for ten minutes — so the difference
 * between "poll again" and "the user asked" has to reach it.
 */
describe('refreshing', () => {
  it('tells the provider to forget when the user asks', async () => {
    const forced = sidebar.refreshRemote();
    await flush();
    settle(0);
    await forced;
    expect(env.forgetCount).toBe(1);
  });

  it('does not, for a re-read the app asked for itself', async () => {
    // Submitting a review verdict changes the reviewer votes, which
    // come from the list. It changes no CI verdict and no comment
    // count, so making the provider cold again would spend a cycle's
    // worth of requests for nothing.
    const quiet = sidebar.refreshPrList();
    await flush();
    settle(0);
    await quiet;
    expect(env.forgetCount).toBe(0);
    expect(env.fetchCount).toBe(1);
  });
});

/**
 * Replacing a rejected access token has to look like it worked: the
 * cache is dropped and refetched (its spec), and the renderer is told
 * at once.
 */
describe('after the credentials change', () => {
  it('tells the renderer straight away and fetches again', async () => {
    const first = sidebar.refreshRemote();
    await flush();
    settle(0, { a: 1 });
    await first;

    let announced = 0;
    pullRequests.setRemoteUpdatedNotifier(() => announced++);
    sidebar.onCredentialsChanged();
    // The cleared error is itself a change worth painting, before
    // the fetch it started has landed.
    expect(announced).toBe(1);
    await flush();
    expect(env.fetchCount).toBe(2);
    settle(1, {});
    pullRequests.setRemoteUpdatedNotifier(null);
  });
});

/**
 * A babysitter reads its pull request through the sidebar's cache, so
 * a watched row costs the provider nothing beyond the list the sidebar
 * fetches anyway.
 */
describe('lookupPullRequest', () => {
  it('answers from the same list the sidebar shows', async () => {
    const model = sidebar.listSidebarItems();
    await flush();
    settle(0, { feature: { id: 7 } });
    await model;
    const found = await pullRequests.lookupPullRequest('/repo-a', 7);
    expect(found).toMatchObject({ kind: 'found', pr: { id: 7 } });
    expect(env.fetchCount).toBe(1);
  });

  it('cannot say when no provider is configured', async () => {
    env.configured = false;
    expect(await pullRequests.lookupPullRequest('/repo-a', 7)).toMatchObject({
      kind: 'unknown',
    });
    expect(pullRequests.repoProvider('/repo-a')).toBeNull();
  });
});

describe('sidebar model', () => {
  it('shows a worktree its real branch name, not the sanitized session name', async () => {
    // The lookup comes from the rows, not only from branches with a PR —
    // so a PR-less `feat/foo` still displays as `feat/foo`.
    env.worktrees = [checkout('feat/foo')];
    const model = sidebar.listSidebarItems();
    await flush();
    settle(0);
    await model;

    expect(
      env.lastBranchMap.get(
        worktreeSessionKey('/repo-a/.claude/worktrees/feat/foo', '/repo-a')
      )
    ).toBe('feat/foo');
  });

  it('carries a mid-rebase worktree state through to its session', async () => {
    env.worktrees = [checkout('rebasing-one', '/repo-a', 'rebasing')];
    const model = sidebar.listSidebarItems();
    await flush();
    settle(0);
    const items = (await model) as { state?: string }[];
    expect(items[0].state).toBe('rebasing');
  });

  it('decorates the rows with the babysitters of the open repository', async () => {
    env.babysat.set('/repo-a', new Map([[7, { prId: 7 }]]));
    env.babysat.set('/repo-b', new Map([[8, { prId: 8 }]]));
    const model = sidebar.listSidebarItems();
    await flush();
    settle(0);
    await model;
    expect([...(env.lastBabysat?.keys() ?? [])]).toEqual([7]);
  });

  it('omits the state key entirely for a normal worktree', async () => {
    env.worktrees = [checkout('normal')];
    const model = sidebar.listSidebarItems();
    await flush();
    settle(0);
    const items = (await model) as Record<string, unknown>[];
    expect('state' in items[0]).toBe(false);
  });
});

/**
 * The sidebar is the left half of the window, and most of what it
 * shows — worktrees, their agents, their git state — is local and
 * available in milliseconds. Pull requests are not: they are a network
 * round trip away, and on a cold start there is no cache to serve them
 * from. Waiting for the second before painting the first cost roughly
 * three quarters of a second of empty sidebar on every launch.
 */
describe('the model never waits for the provider', () => {
  it('answers from local git while the provider call is still in flight', async () => {
    env.worktrees = [checkout('feature')];

    // No `settle` anywhere: if this ever awaits the fetch again, the
    // await below never resolves and the test times out.
    const model = (await sidebar.listSidebarItems()) as unknown[];

    expect(model).toHaveLength(1);
    expect(env.fetchCount).toBe(1);
    expect(env.pending).toHaveLength(1);
  });

  it('serves the pull requests on the next call, once they have landed', async () => {
    env.worktrees = [checkout('feature')];
    await sidebar.listSidebarItems();
    settle(0, { feature: { id: 7 } });
    await flush();

    await sidebar.listSidebarItems();
    // Still one request: the second call read the cache the first
    // call's fetch filled, rather than starting another.
    expect(env.fetchCount).toBe(1);
  });

  it('announces the pull requests when the background fetch commits', async () => {
    let announced = 0;
    pullRequests.setRemoteUpdatedNotifier(() => announced++);

    await sidebar.listSidebarItems();
    // Nothing to say yet — the model that just went out is local-only.
    expect(announced).toBe(0);

    settle(0, { feature: { id: 7 } });
    await flush();
    // Without this the first pull requests of a session would appear
    // whenever the renderer next polled, up to four seconds later.
    expect(announced).toBe(1);
  });

  it('stays quiet when the cache was already fresh', async () => {
    await sidebar.listSidebarItems();
    settle(0);
    await flush();

    let announced = 0;
    pullRequests.setRemoteUpdatedNotifier(() => announced++);
    await sidebar.listSidebarItems();
    await flush();

    expect(env.fetchCount).toBe(1);
    expect(announced).toBe(0);
  });
});

describe('getSidebarSnapshot', () => {
  it('stamps the rows with the repository they describe', async () => {
    env.worktrees = [checkout('feature')];
    const snapshot = await sidebar.getSidebarSnapshot();
    expect(snapshot.cwd).toBe('/repo-a');
    expect(snapshot.items).toHaveLength(1);
  });

  it('answers for the repository the host is on once a switch lands mid-call', async () => {
    // The worktree list is where the call awaits; the host moves to
    // another repository while it is out. Stamping the rows that come
    // back with either repo would be wrong — they were listed under
    // one and had their sessions judged under the other — so the
    // snapshot is the new repository's, computed whole.
    const listedUnderA = [checkout('from-a')];
    env.holdWorktrees = true;
    const pending = sidebar.getSidebarSnapshot();
    await flush();
    env.cwd = '/repo-b';
    env.worktrees = [checkout('from-b', '/repo-b')];
    env.releaseWorktrees?.(listedUnderA);
    const snapshot = await pending;
    expect(snapshot.cwd).toBe('/repo-b');
    expect(snapshot.items).toEqual([
      expect.objectContaining({
        name: worktreeSessionKey('/repo-b/.claude/worktrees/from-b', '/repo-b'),
      }),
    ]);
  });
});
