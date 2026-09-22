import type { LaunchStep } from '../../../host/contract.js';
import {
  MachineChoiceSelect,
  RemoteLaunchProgress,
  type useMachineChoice,
} from '../terminal/NewTerminalMachineChoice.js';

/**
 * The session menu's machine choice and remote launch progress
 * (ux-machines.md §5) — split out of `LaunchDialog` to keep its line
 * budget, and reusing Phase 7's terminal-dialog machinery
 * (`useMachineChoice`, `MachineChoiceSelect`, `RemoteLaunchProgress`)
 * rather than a second implementation of the same D8 gate and step
 * copy. `LaunchDialog` renders this only outside "Continue" — an
 * existing session is already qualified to whatever machine it was
 * created on, so there is nothing to choose there.
 */
export function LaunchMachineSection({
  choice,
  step,
  error,
  what,
}: {
  choice: ReturnType<typeof useMachineChoice>;
  step?: LaunchStep | null;
  error?: string | null;
  what: string;
}) {
  return (
    <>
      <MachineChoiceSelect id="launch-machine" choice={choice} />
      <RemoteLaunchProgress
        step={step}
        error={error}
        machineLabel={choice.selectedLabel()}
        what={what}
      />
    </>
  );
}
