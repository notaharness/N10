import { PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { useMachines } from '../../lib/data/queries.js';
import { Button } from '../ui/button.js';
import { Skeleton } from '../ui/skeleton.js';
import { AcceptConnectionsPanel } from '../machines/AcceptConnectionsPanel.js';
import { MachineRow } from '../machines/MachineRow.js';
import { PairMachineDialog } from '../machines/PairMachineDialog.js';

/**
 * The Machines settings group: the machine list (local first, then
 * paired peers by label), pairing in both directions, and the accept-
 * connections panel. Repo-independent — see settings-groups.ts's
 * special case for this group, the same one `'appearance'` gets.
 */
export function MachineRows() {
  const machines = useMachines();
  const [pairOpen, setPairOpen] = useState(false);
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

  return (
    <>
      {peers.length === 0 ? (
        <div className="px-4 py-4">
          <p className="text-sm text-muted-foreground">
            Pair a machine once and either side can reach the other. Pairing
            grants a shell as your user, and can be revoked at any time.
          </p>
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={() => setPairOpen(true)}>
              <PlusIcon className="size-3.5" />
              Add a machine
            </Button>
          </div>
          {local && (
            <div className="mt-3 divide-y divide-border rounded-md border border-border">
              <MachineRow machine={local} />
            </div>
          )}
        </div>
      ) : (
        <div className="divide-y divide-border">
          <div className="flex items-center justify-end px-4 py-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setPairOpen(true)}
            >
              <PlusIcon className="size-3.5" />
              Add a machine
            </Button>
          </div>
          {local && <MachineRow machine={local} />}
          {peers.map((m) => (
            <MachineRow key={m.peerId} machine={m} />
          ))}
        </div>
      )}

      <div className="border-t border-border">
        <AcceptConnectionsPanel />
      </div>

      {pairOpen && <PairMachineDialog onClose={() => setPairOpen(false)} />}
    </>
  );
}
