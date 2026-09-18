import type { MachineView } from '../../../host/contract.js';
import { machineSelectOptions } from '../../lib/machines/machine-model.js';
import { Label } from '../ui/label.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select.js';

/**
 * The machine a launch runs on (ux-machines.md §5). Callers render this
 * only when a peer machine is registered (D8) — with only the local
 * machine, there is nothing to choose, and this component does not
 * decide that on its own.
 *
 * A machine that cannot be launched on right now is listed disabled
 * with its reason beside it, never omitted: a user who paired a
 * machine and cannot find it here would otherwise conclude pairing
 * failed.
 */
export function MachineSelect({
  id,
  machines,
  value,
  onChange,
}: {
  id: string;
  machines: MachineView[];
  /** The selected machine's peerId. */
  value: string;
  onChange: (peerId: string) => void;
}) {
  const options = machineSelectOptions(machines);
  return (
    <div className="min-w-0 space-y-2">
      <Label htmlFor={id}>Machine</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} aria-label="Machine" className="w-full min-w-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map(({ machine, disabled, reason }) => (
            <SelectItem
              key={machine.peerId}
              value={machine.peerId}
              disabled={disabled}
            >
              <span className="truncate">{machine.label}</span>
              {reason && (
                <span className="truncate text-muted-foreground">
                  {' '}
                  — {reason}
                </span>
              )}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
