import { useFleet } from '../../lib/fleet/fleet-context.js';
import { Button } from '../ui/button.js';

/** The Machines settings group: Fleet owns machines, so this only
 *  points there (beam-fleet-ux.md §1). */
export function MachineRows() {
  const { show } = useFleet();
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-4">
      <p className="text-sm text-muted-foreground">
        Manage your machines, passkeys and fleet recovery in Fleet.
      </p>
      <Button size="sm" variant="outline" onClick={show}>
        Open Fleet
      </Button>
    </div>
  );
}
