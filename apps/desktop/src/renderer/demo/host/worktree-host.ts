import type { WorktreeInfo } from '@n10/worktree-manager';
import type { N10HostApi, SyncState } from '../../../host/contract.js';
import { babysitting, worktreeDir } from '../data/identity.js';
import { Channel, later } from './hub.js';
import type { DemoState } from './state.js';

/**
 * The open repository's sidebar, sync state, worktrees and branches,
 * and babysitting. Removing a worktree is declined: in the page there
 * is nothing on disk to remove, and the demo's rows are its story.
 */
function syncState(): SyncState {
  const now = Date.now();
  return {
    providerId: 'github',
    providerConfigured: true,
    lastRemoteSyncAt: now - 20_000,
    lastGitSyncAt: now - 45_000,
    remoteError: null,
    remoteSyncing: false,
    remoteIntervalMs: 60_000,
    remoteFetches: 12,
  };
}

type WorktreeHost = Pick<
  N10HostApi,
  | 'getSidebarModel'
  | 'getSyncState'
  | 'refreshRemote'
  | 'listWorktrees'
  | 'listBranches'
  | 'listAllBranches'
  | 'createWorktree'
  | 'removeWorktree'
  | 'canRemoveBranch'
  | 'openInEditor'
  | 'onSyncNotice'
  | 'onRemoteUpdated'
  | 'onDiscoveryChanged'
  | 'startBabysit'
  | 'stopBabysit'
  | 'onBabysitChanged'
>;

export function createWorktreeHost(state: DemoState): WorktreeHost {
  // The demo pushes no sync notices or babysitter changes.
  const never = new Channel<never>();
  const repo = () => state.repo();
  return {
    getSidebarModel: () => later({ cwd: repo().cwd, items: repo().sidebar }),
    getSyncState: () => later(syncState()),
    refreshRemote: () => later(undefined, 500),
    listWorktrees: () => {
      const { cwd, data, worktrees } = repo();
      return later<WorktreeInfo[]>([
        { path: cwd, branch: data.defaultBranch, bare: false },
        ...[...worktrees].map((branch) => ({
          path: worktreeDir(cwd, branch),
          branch,
          bare: false,
        })),
      ]);
    },
    listBranches: () => later([...repo().data.branches]),
    listAllBranches: () =>
      later([...repo().data.branches, `origin/${repo().data.defaultBranch}`]),
    createWorktree: (branch) => {
      repo().worktrees.add(branch);
      return later(worktreeDir(repo().cwd, branch), 300);
    },
    removeWorktree: () => later(false),
    canRemoveBranch: () =>
      later({ safe: false as const, reason: 'The demo keeps its worktrees.' }),
    openInEditor: () => later({ editor: 'code' }),
    onSyncNotice: never.subscribe,
    onRemoteUpdated: state.remoteUpdated.subscribe,
    onDiscoveryChanged: state.discovery.subscribe,
    startBabysit: (prId) => {
      const pr = repo().pr(prId);
      if (!pr) return Promise.reject(new Error('Not in the sidebar'));
      const status = babysitting(pr);
      repo().updateItem(
        (item) => item.pr?.id === prId,
        (item) => ({ ...item, babysit: status })
      );
      return later(status);
    },
    stopBabysit: (prId) => {
      repo().updateItem(
        (item) => item.pr?.id === prId,
        (item) => ({ ...item, babysit: undefined })
      );
      return later(undefined);
    },
    onBabysitChanged: never.subscribe,
  };
}
