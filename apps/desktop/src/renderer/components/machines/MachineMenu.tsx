import { MoreHorizontalIcon } from 'lucide-react';
import { toast } from 'sonner';
import type {
  MachineGrant,
  MachineView,
} from '../../../host/contract-machines.js';
import { copyText } from '../../lib/copy-text.js';
import { useSetMachineGrant } from '../../lib/data/mutations-machines.js';
import {
  fingerprintGroups,
  isFleetMember,
} from '../../lib/machines/machine-model.js';
import { errorMessage } from '../../lib/utils.js';
import { Button } from '../ui/button.js';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu.js';

/** What each grant lets that machine open here (beam docs/04). */
const GRANTS: { grant: MachineGrant; label: string }[] = [
  { grant: 'all', label: 'Shells and messages' },
  { grant: 'msg', label: 'Messages only' },
  { grant: 'none', label: 'No access' },
];

/** Copies the 64-bit fingerprint as displayed, not the full peerId
 *  (beam-fleet-ux.md §1). */
export function copyFingerprint(peerId: string): void {
  copyText(fingerprintGroups(peerId), 'Fingerprint copied');
}

/** A machine row's actions: alias, grant and revoke for a member (beam
 *  docs/08), copying the fingerprint for any row. */
export function MachineMenu({
  machine,
  disabled,
  onRename,
  onRevoke,
}: {
  machine: MachineView;
  disabled: boolean;
  onRename: () => void;
  onRevoke: () => void;
}) {
  const grant = useSetMachineGrant();
  const member = isFleetMember(machine);
  const setGrant = (next: MachineGrant) =>
    grant.mutate(
      { peerId: machine.peerId, grant: next },
      { onError: (err: unknown) => toast.error(errorMessage(err)) }
    );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Machine actions">
          <MoreHorizontalIcon className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {member && (
          <DropdownMenuItem disabled={disabled} onSelect={onRename}>
            Rename here…
          </DropdownMenuItem>
        )}
        {member && (
          <DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>
              Access this machine allows from {machine.label}
            </DropdownMenuLabel>
            {GRANTS.map((g) => (
              <DropdownMenuCheckboxItem
                key={g.grant}
                disabled={disabled}
                checked={machine.grant === g.grant}
                onSelect={() => setGrant(g.grant)}
              >
                {g.label}
              </DropdownMenuCheckboxItem>
            ))}
            <DropdownMenuSeparator />
          </DropdownMenuGroup>
        )}
        <DropdownMenuItem onSelect={() => copyFingerprint(machine.peerId)}>
          Copy fingerprint
        </DropdownMenuItem>
        {member && (
          <DropdownMenuItem
            variant="destructive"
            disabled={disabled}
            onSelect={onRevoke}
          >
            Revoke {machine.label}…
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
