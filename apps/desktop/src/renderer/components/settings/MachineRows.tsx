import { useFleet } from '../../lib/fleet/fleet-context.js';
import { Button } from '../ui/button.js';

/** The Machines settings group: the sidebar's Fleet section owns
 *  machines, so this only points there (beam-fleet-ux.md §1). */
export function MachineRows() {
  const { reveal } = useFleet().section;
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-4">
      <p className="text-sm text-muted-foreground">
        Manage your machines, passkeys and fleet recovery in the sidebar’s Fleet section.
      </p>
      <Button size="sm" variant="outline" onClick={reveal}>
        Show Fleet
      </Button>
    </div>
  );
}
