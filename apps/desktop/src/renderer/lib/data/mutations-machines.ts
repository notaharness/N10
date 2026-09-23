import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { MachineGrant } from '../../../host/contract-machines.js';
import { keys } from './query-keys.js';

/**
 * The renderer's machine writes — alias, grant, dismissing a refused
 * report. Split from `mutations.ts` (a catalogue already), mirroring
 * `mutations-terminals.ts`. Machines are pushed on every change
 * (`onMachinesChanged`), so these invalidate `keys.machines` only as a
 * fallback for a push that raced the mutation response.
 */

export function useSetMachineAlias() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { peerId: string; alias: string | null }) =>
      window.n10.setMachineAlias(args.peerId, args.alias),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.machines });
    },
  });
}

export function useSetMachineGrant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { peerId: string; grant: MachineGrant }) =>
      window.n10.setMachineGrant(args.peerId, args.grant),
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
