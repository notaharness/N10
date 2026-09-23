import { useMachines } from '../../lib/data/queries.js';
import { Skeleton } from '../ui/skeleton.js';
import { MachineRow } from '../machines/MachineRow.js';

/**
 * The Machines settings group: this machine first, then its peers by
 * label. Repo-independent — see settings-groups.ts's special case for
 * this group, the same one `'appearance'` gets.
 */
export function MachineRows() {
  const machines = useMachines();
  const list = machines.data ?? [];
  const local = list.find((m) => m.isLocal);
  const peers = list.filter((m) => !m.isLocal);

  if (machines.isLoading) {
    return (
      <div className="space-y-2 p-4">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  if (!local) {
    return (
      <p className="px-4 py-4 text-sm text-muted-foreground">
        No machines available.
      </p>
    );
  }

  return (
    <div className="divide-y divide-border">
      <MachineRow machine={local} />
      {peers.map((m) => (
        <MachineRow key={m.peerId} machine={m} />
      ))}
    </div>
  );
}
