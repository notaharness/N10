/**
 * The main process's outbound half: everything the host pushes to the
 * renderer without being asked, plus the per-repo background work that
 * produces most of it.
 *
 * Each service exposes a setter rather than reaching for Electron
 * itself — none of them may import `electron` and stay testable — so
 * this is where the two meet. It lives beside `main.ts` rather than in
 * it because it is one subject, and because every window-broadcast in
 * the app should be findable in one place.
 */
import { BrowserWindow } from 'electron';
import {
  BABYSIT_EVENTS,
  DISCOVERY_EVENTS,
  SYNC_EVENTS,
} from '../host/contract.js';
import { setRepoOpenedListener } from '../host/services/repo.js';
import {
  setSyncNotifier,
  startRemoteSyncLoop,
} from '../host/services/remote-sync.js';
import { setRemoteUpdatedNotifier } from '../host/services/pull-requests.js';
import {
  setDiscoveryNotifier,
  startDiscoveryForRepo,
} from '../host/services/discovery.js';
import { setSessionBroadcaster } from '../host/services/sessions.js';
import { setBabysitNotifier } from '../host/services/babysit.js';

function broadcast(channel: string, payload?: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload);
  }
}

/** Wire every host → renderer push, and the per-repo loops behind
 *  them. Call once at startup, before the first repo is opened. */
export function installHostEventBridge(): void {
  setSessionBroadcaster(broadcast);

  // Per-repo background work, (re)started whenever a repo is opened.
  // The sync loop's user-facing events (auto-deleted merged branch, …)
  // toast in the renderer; discovery attaches to agent sessions this
  // process did not start — including the ones that survived a previous
  // run, which is what makes them show as running straight away.
  setRepoOpenedListener((cwd) => {
    startRemoteSyncLoop(cwd);
    startDiscoveryForRepo(cwd);
  });

  setSyncNotifier((notice) => broadcast(SYNC_EVENTS.notice, notice));

  // The sidebar model answers from local git without waiting for the
  // provider, so the renderer needs telling when the pull requests
  // finally arrive — otherwise they wait out its poll interval.
  setRemoteUpdatedNotifier(() => broadcast(SYNC_EVENTS.remote));

  // Same idea for the local half: a worktree or session that appeared
  // outside this process changes what the sidebar should show, and the
  // renderer is serving it from a query cache.
  setDiscoveryNotifier(() => broadcast(DISCOVERY_EVENTS.changed));

  // A babysitter started an agent (a row and a session) or ended; its
  // status otherwise rides on the sidebar item.
  setBabysitNotifier((event) => broadcast(BABYSIT_EVENTS.changed, event));
}
