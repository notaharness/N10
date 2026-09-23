import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { keys } from '../lib/data/query-keys.js';

/**
 * The workspace's subscriptions to what the host pushes — sync
 * notices, remote updates, session exits, discovery, babysit events —
 * and the query invalidation each one owes. Split from `Workspace`,
 * which routes menu commands and shortcuts and was a catalogue already.
 *
 * `terminalEnded` is the tab api's, so a terminal tab closes on the
 * exit event itself rather than on the next listing.
 */
export function useHostEvents(
  cwd: string,
  terminalEnded: (name: string) => void
): void {
  const qc = useQueryClient();

  // The host's remote sync loop toasts its events (auto-deleted merged
  // branch, blocked auto-delete) and the sidebar refetches to match.
  useEffect(() => {
    const off = window.n10.onSyncNotice(({ message, kind }) => {
      if (kind === 'success') toast.success(message);
      else toast.warning(message);
      void qc.invalidateQueries({ queryKey: keys.sidebar(cwd) });
    });
    return off;
  }, [qc, cwd]);

  // The host serves the sidebar from local git without waiting for the
  // provider, and says so when the pull requests land. Refetching on
  // that event is what keeps "fast" from meaning "stale for four
  // seconds": the rows appear as soon as the host has them.
  useEffect(() => {
    const off = window.n10.onRemoteUpdated(() => {
      void qc.invalidateQueries({ queryKey: keys.sidebar(cwd) });
      void qc.invalidateQueries({ queryKey: keys.sync(cwd) });
    });
    return off;
  }, [qc, cwd]);

  // A terminal tab closes itself when its process ends. The host has
  // already dropped the terminal from its listing when it says so, and
  // the tab goes on the event itself — by name, so a terminal that died
  // before any listing named it closes too — rather than on the next
  // poll; the listing is refetched behind it to prune the auto-open
  // stamp. A worktree agent's exit rides the same event and names no
  // terminal tab, so it closes nothing.
  useEffect(() => {
    const off = window.n10.onSessionExit(({ name, retained }) => {
      if (!retained) terminalEnded(name);
      void qc.invalidateQueries({ queryKey: keys.terminals });
    });
    return off;
  }, [qc, terminalEnded]);

  // Worktrees and agent sessions can also appear without this process
  // being involved — a second n10, a script, an operator with tmux.
  // The host notices and says so; the sidebar is a query cache, so it
  // has to be told to look again.
  useEffect(() => {
    const off = window.n10.onDiscoveryChanged(() => {
      void qc.invalidateQueries({ queryKey: keys.sidebar(cwd) });
      void qc.invalidateQueries({ queryKey: keys.sessions(cwd) });
      // Discovery also brings back terminal tabs, and what it found
      // may be another repository's agent too.
      void qc.invalidateQueries({ queryKey: keys.terminals });
      void qc.invalidateQueries({ queryKey: keys.foreignSessions });
      // A worktree added from outside usually brought a branch with it.
      void qc.invalidateQueries({ queryKey: keys.branches(cwd) });
    });
    return off;
  }, [qc, cwd]);

  // A babysat pull request's status rides on its sidebar item, so the
  // poll shows it. The host pushes only what a poll would show too
  // late: an agent it started (a row and a session), or a watch that
  // ended with its pull request.
  useEffect(() => {
    const off = window.n10.onBabysitChanged((event) => {
      if (event.ended) {
        toast.info(
          `Stopped babysitting #${event.ended.prId}: the pull request is no longer open`
        );
      }
      void qc.invalidateQueries({ queryKey: keys.sidebar(cwd) });
      void qc.invalidateQueries({ queryKey: keys.sessions(cwd) });
    });
    return off;
  }, [qc, cwd]);
}
