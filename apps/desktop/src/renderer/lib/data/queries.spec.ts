import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  N10HostApi,
  RepoInfo,
  SidebarItem,
} from '../../../host/contract.js';
import { keys, resetRepoScopedCache } from './query-keys.js';
import {
  acceptingStatusQuery,
  loadBranchRemovalSafety,
  loadRepoGate,
  loadSidebarModel,
  machinesQuery,
} from './queries.js';

/**
 * The renderer runs in a browser; these tests run in node. Only the
 * handful of bridge calls each case exercises is stubbed — anything
 * else being reached is itself a failure worth seeing.
 */
function stubHost(api: Partial<N10HostApi>): void {
  (globalThis as { window?: unknown }).window = { n10: api };
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

const REPO: RepoInfo = {
  cwd: '/repo',
  providerId: null,
  vcsConfigured: false,
};

/** The value of `p`, or 'pending' if it has not settled by the time
 *  every already-queued task has run. */
async function state(p: Promise<unknown>): Promise<unknown> {
  await new Promise((r) => setTimeout(r, 0));
  return Promise.race([p, Promise.resolve('pending')]);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('loadRepoGate', () => {
  it('reports no repository when the host cannot name one', async () => {
    stubHost({
      getRepo: () => Promise.reject(new Error('host is not ready')),
      getDesktopPrefs: () =>
        Promise.resolve({ theme: 'system' as const, nativeFrame: false }),
    });

    // A rejection here must not surface as a failed query: the gate
    // would sit on its loading screen forever instead of falling
    // through to the repo picker.
    await expect(loadRepoGate()).resolves.toBeNull();
  });

  it('waits for the desktop prefs before reporting the repository', async () => {
    const prefs = deferred<{ theme: 'system'; nativeFrame: boolean }>();
    stubHost({
      getRepo: () => Promise.resolve(REPO),
      getDesktopPrefs: () => prefs.promise,
    });

    const gate = loadRepoGate();

    // The repo is known, but the theme and frame the workspace paints
    // with are not — resolving now would paint the wrong one first.
    expect(await state(gate)).toBe('pending');

    prefs.resolve({ theme: 'system', nativeFrame: false });
    expect(await gate).toEqual(REPO);
  });

  it('reports the repository even when the prefs cannot be read', async () => {
    stubHost({
      getRepo: () => Promise.resolve(REPO),
      getDesktopPrefs: () => Promise.reject(new Error('no prefs file')),
    });

    await expect(loadRepoGate()).resolves.toEqual(REPO);
  });
});

describe('loadBranchRemovalSafety', () => {
  it('passes the host verdict through', async () => {
    stubHost({
      canRemoveBranch: () =>
        Promise.resolve({ safe: false, reason: 'rebase in progress' }),
    });

    await expect(loadBranchRemovalSafety('wip')).resolves.toEqual({
      safe: false,
      reason: 'rebase in progress',
    });
  });

  it('refuses when the host call fails, rather than failing', async () => {
    stubHost({
      canRemoveBranch: () => Promise.reject(new Error('not a git repository')),
    });

    // The dialog only ever reads this value. A rejection left as query
    // error state would leave `data` undefined, which is the same shape
    // as "still loading" — and an unanswerable question must refuse,
    // not offer a confirm button.
    await expect(loadBranchRemovalSafety('wip')).resolves.toEqual({
      safe: false,
      reason: 'not a git repository',
    });
  });
});

describe('resetRepoScopedCache', () => {
  function seeded() {
    const qc = new QueryClient();
    qc.setQueryData(keys.repo, REPO);
    qc.setQueryData(keys.sidebar('/repo'), ['row']);
    qc.setQueryData(keys.settings('/repo'), { fields: [] });
    qc.setQueryData(keys.threads('/repo', 7), { threads: [] });
    qc.setQueryData(keys.version, { app: '1', electron: '2' });
    qc.setQueryData(keys.terminals, [{ name: 'n10-shell' }]);
    qc.getMutationCache().build(qc, { mutationFn: () => Promise.resolve(1) });
    return qc;
  }

  // Terminals belong to directories, not to the repository being left;
  // dropping them would blank every terminal tab on a switch until the
  // next poll, and a restored terminal's tab is opened off this list.
  it('keeps the terminal listing, which no repository owns', () => {
    const qc = seeded();
    resetRepoScopedCache(qc);
    expect(qc.getQueryData(keys.terminals)).toEqual([{ name: 'n10-shell' }]);
  });

  it('keeps the open repository so the gate never blanks', () => {
    const qc = seeded();

    resetRepoScopedCache(qc);

    // Dropping this entry would drop the gate's observer back into its
    // pending state, flashing "Connecting to host…" between the repo
    // being left and the one being opened.
    expect(qc.getQueryData(keys.repo)).toEqual(REPO);
  });

  it('drops everything that belonged to the repository being left', () => {
    const qc = seeded();

    resetRepoScopedCache(qc);

    expect(qc.getQueryData(keys.sidebar('/repo'))).toBeUndefined();
    expect(qc.getQueryData(keys.settings('/repo'))).toBeUndefined();
    expect(qc.getQueryData(keys.threads('/repo', 7))).toBeUndefined();
    expect(qc.getQueryData(keys.version)).toBeUndefined();
  });

  it('drops in-flight mutation state', () => {
    const qc = seeded();
    expect(qc.getMutationCache().getAll()).toHaveLength(1);

    resetRepoScopedCache(qc);

    // A worktree removal pending in the old repo would otherwise keep
    // hiding a same-named sidebar row in the new one.
    expect(qc.getMutationCache().getAll()).toHaveLength(0);
  });
});

describe('loadSidebarModel', () => {
  const row = (name: string): SidebarItem => ({
    kind: 'session',
    session: { name, running: true },
    branch: name,
    isMerged: false,
  });

  it('takes the rows when the host answers for this repository', async () => {
    stubHost({
      getSidebarModel: () =>
        Promise.resolve({ cwd: '/repo', items: [row('feature')] }),
    });
    await expect(loadSidebarModel('/repo', [row('old')])).resolves.toEqual([
      row('feature'),
    ]);
  });

  it('keeps the rows it had when the host answers for another one', async () => {
    // The state a repo switch passes through: the host has moved on,
    // this workspace is still polling. The other repository's rows
    // must never reach this repository's tabs.
    stubHost({
      getSidebarModel: () =>
        Promise.resolve({ cwd: '/elsewhere', items: [row('theirs')] }),
    });
    await expect(loadSidebarModel('/repo', [row('mine')])).resolves.toEqual([
      row('mine'),
    ]);
  });

  it('shows nothing rather than another repository’s rows on a first poll', async () => {
    stubHost({
      getSidebarModel: () =>
        Promise.resolve({ cwd: '/elsewhere', items: [row('theirs')] }),
    });
    await expect(loadSidebarModel('/repo', undefined)).resolves.toEqual([]);
  });
});

describe('acceptingStatusQuery', () => {
  it('fetches whether or not the panel is open', () => {
    // Nothing else reads this machine's accepting state — it does not
    // ride the `onMachinesChanged` push — so a query that only runs
    // while the panel is expanded leaves the switch falling back to
    // `accepting: false`, rendering "off" beside copy promising this
    // machine cannot be dialled from elsewhere, for a machine that is
    // in fact accepting connections.
    expect(acceptingStatusQuery(false).enabled).toBe(true);
    expect(acceptingStatusQuery(true).enabled).toBe(true);
  });

  it('polls only while the panel is open', () => {
    // The 1s poll is the countdown's, and the countdown is only on
    // screen while the panel is expanded.
    expect(acceptingStatusQuery(true).refetchInterval).toBe(1_000);
    expect(acceptingStatusQuery(false).refetchInterval).toBe(false);
  });
});

describe('machinesQuery', () => {
  it('leaves the list to the push rather than polling it often', () => {
    // `StatusBar` is always mounted and calls `useMachines`
    // unconditionally, so this interval is every install's baseline
    // IPC traffic — including the local-only installs D8 hides every
    // machines surface from, whose one machine cannot change. Real
    // changes arrive on `onMachinesChanged`; this only catches a push
    // that never came.
    expect(machinesQuery().refetchInterval).toBeGreaterThanOrEqual(60_000);
  });
});
