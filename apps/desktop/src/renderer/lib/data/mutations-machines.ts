import { useMutation, useQueryClient } from '@tanstack/react-query';
import { keys } from './query-keys.js';

/**
 * The renderer's machine writes — rename, revoke, dismissing a refused
 * report. Split from `mutations.ts` (a catalogue
 * already), mirroring `mutations-terminals.ts`. Machines are pushed on
 * every change (`onMachinesChanged`), so most of these invalidate
 * `keys.machines` only as a fallback for a push that raced the mutation
 * response — the push channel is the primary path.
 */

export function useRenameMachine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { peerId: string; label: string }) =>
      window.n10.renameMachine(args.peerId, args.label),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.machines });
    },
  });
}

export function useRevokeMachine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (peerId: string) => window.n10.revokeMachine(peerId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.machines });
    },
  });
}

/** Discards a refused report without delivering it — the confirm text
 *  says this removes it from the sender's mailbox for good. */
export function useDismissInboundMail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => window.n10.dismissInboundMail(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.machines });
    },
  });
}
