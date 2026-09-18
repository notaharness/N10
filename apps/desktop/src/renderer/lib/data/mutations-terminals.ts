import { useMutation, useQueryClient } from '@tanstack/react-query';
import { keys } from './query-keys.js';
import type { TerminalLaunchRequest } from '../../../host/contract.js';

/**
 * The renderer's terminal-tab writes — launch a terminal in a
 * directory, kill one. Split from `mutations.ts`, which is a catalogue
 * already.
 */

export function useLaunchTerminal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: TerminalLaunchRequest) => window.n10.launchTerminal(req),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.terminals });
      // A terminal at another repository's root put that repo on the
      // recents list.
      void qc.invalidateQueries({ queryKey: keys.recents });
    },
  });
}

export function useKillTerminal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => window.n10.killTerminal(name),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.terminals });
    },
  });
}

/** The pane's manual "Reconnect" action (ux-machines.md §6), for a
 *  session in `connectionState: 'failed'` — after Phase 5's bounded
 *  automatic retry has given up. Works for a worktree session's pane
 *  as much as a terminal tab's: both read `getSession` from the same
 *  registry host-side, and the host op is shared. No invalidation here
 *  — `connectionState` rides the existing sessions/terminals poll. */
export function useReconnectSession() {
  return useMutation({
    mutationFn: (name: string) => window.n10.reconnectSession(name),
  });
}
