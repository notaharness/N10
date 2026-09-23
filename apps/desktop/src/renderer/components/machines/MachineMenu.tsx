import { MoreHorizontalIcon } from 'lucide-react';
import { toast } from 'sonner';
import type {
  MachineGrant,
  MachineView,
} from '../../../host/contract-machines.js';
import { useSetMachineGrant } from '../../lib/data/mutations-machines.js';
import { isFleetMember } from '../../lib/machines/machine-model.js';
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
  { grant: 'all', label: 'Shell, commands and messages' },
  { grant: 'msg', label: 'Messages only' },
  { grant: 'none', label: 'Nothing' },
];

export function copyFingerprint(peerId: string): void {
  navigator.clipboard.writeText(peerId).then(
    () => toast.success('Fingerprint copied'),
    () => toast.error('Could not copy the fingerprint')
  );
}

/** A machine row's actions: alias, grant and revoke for a member (beam
 *  docs/08), copying the fingerprint for any row. */
export function MachineMenu({
  machine,
  onRename,
  onRevoke,
}: {
  machine: MachineView;
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
          <DropdownMenuItem onSelect={onRename}>Rename here…</DropdownMenuItem>
        )}
        {member && (
          <DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Allow on this machine</DropdownMenuLabel>
            {GRANTS.map((g) => (
              <DropdownMenuCheckboxItem
                key={g.grant}
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
          <DropdownMenuItem variant="destructive" onSelect={onRevoke}>
            Revoke…
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
