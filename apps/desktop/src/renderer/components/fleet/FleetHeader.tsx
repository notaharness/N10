import { CopyIcon, PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { copyText } from '../../lib/copy-text.js';
import { fingerprintGroups } from '../../lib/machines/machine-model.js';
import { Button } from '../ui/button.js';
import { AddMachineDialog } from './AddMachineDialog.js';

/**
 * The fleet this machine belongs to, by fingerprint — the 64 bits of
 * `fleetId` that `beam status` prints, and what Copy copies — and the
 * actions on it (beam-fleet-ux.md §1).
 */
export function FleetHeader({
  fleetId,
  disabled,
  onReset,
}: {
  fleetId: string | null;
  disabled: boolean;
  onReset: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const fingerprint = fleetId ? fingerprintGroups(fleetId) : null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {fingerprint && (
        <div className="mr-auto flex items-center gap-1 text-sm">
          <span className="text-muted-foreground">Fleet fingerprint</span>
          <span
            className="font-mono select-all"
            data-testid="fleet-fingerprint"
          >
            {fingerprint}
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => copyText(fingerprint, 'Fleet fingerprint copied')}
          >
            <CopyIcon />
            Copy fleet fingerprint
          </Button>
        </div>
      )}
      {fingerprint && (
        <Button size="sm" onClick={() => setAdding(true)}>
          <PlusIcon />
          Add a machine
        </Button>
      )}
      <Button size="sm" variant="outline" disabled={disabled} onClick={onReset}>
        Reset fleet on this machine…
      </Button>
      {adding && fingerprint && (
        <AddMachineDialog
          fingerprint={fingerprint}
          onClose={() => setAdding(false)}
        />
      )}
    </div>
  );
}
