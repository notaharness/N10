import { AlertTriangleIcon, Loader2Icon } from 'lucide-react';
import { useState } from 'react';
import type { LaunchStep } from '../../../host/contract.js';
import { useMachines } from '../../lib/data/queries.js';
import {
  hasPeerMachines,
  launchStepLabel,
} from '../../lib/machines/machine-model.js';
import { MachineSelect } from '../machines/MachineSelect.js';

/**
 * The dialog's machine choice (ux-machines.md §5). Split out of
 * `NewTerminalDialog` to keep both files' complexity and length down:
 * this owns "which machine", the dialog owns "where"/"what".
 *
 * `show` is D8's gate — with only the local machine registered there
 * is nothing to choose, and the caller renders no control at all.
 * `selectedMachine()` is what actually goes on the launch request: the
 * local default resolves to `undefined`, never `'local'` or the local
 * machine's own peerId, so a local launch's request is unchanged from
 * before this phase.
 */
export function useMachineChoice() {
  const machines = useMachines();
  const list = machines.data ?? [];
  const local = list.find((m) => m.isLocal);
  const [chosen, setChosen] = useState<string | null>(null);
  const value = chosen ?? local?.peerId ?? '';
  const show = hasPeerMachines(list);
  return {
    show,
    machines: list,
    value,
    setValue: setChosen,
    selectedMachine: (): string | undefined =>
      show && value && value !== local?.peerId ? value : undefined,
    selectedLabel: (): string =>
      list.find((m) => m.peerId === value)?.label ?? '',
  };
}

/** The machine `Select`, rendered only when `useMachineChoice().show`. */
export function MachineChoiceSelect({
  id,
  choice,
}: {
  id: string;
  choice: ReturnType<typeof useMachineChoice>;
}) {
  if (!choice.show) return null;
  return (
    <MachineSelect
      id={id}
      machines={choice.machines}
      value={choice.value}
      onChange={choice.setValue}
    />
  );
}

/** The step display and the failure it can end in (ux-machines.md §5).
 *  Nothing renders for a local launch — the caller only ever has a
 *  step to show when the request named a machine. */
export function RemoteLaunchProgress({
  step,
  error,
  machineLabel,
  what,
}: {
  step?: LaunchStep | null;
  error?: string | null;
  machineLabel: string;
  what: string;
}) {
  if (error) {
    return (
      <p role="alert" className="flex items-center gap-2 text-sm text-warning">
        <AlertTriangleIcon className="size-3.5 shrink-0" />
        {error}
      </p>
    );
  }
  if (!step) return null;
  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2Icon className="size-3.5 shrink-0 animate-spin" />
      {launchStepLabel(step, machineLabel, what)}
    </p>
  );
}
