import { MoreHorizontalIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import type { MachineTone } from '../../lib/machines/machine-model.js';
import {
  fingerprintGroups,
  machinePresentation,
  queueBadgeLabel,
} from '../../lib/machines/machine-model.js';
import { useRenameMachine } from '../../lib/data/mutations-machines.js';
import type { MachineView } from '../../../host/contract-machines.js';
import { errorMessage } from '../../lib/utils.js';
import { Badge } from '../ui/badge.js';
import { Button } from '../ui/button.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu.js';
import { Tip } from '../ui/tooltip.js';
import { ConfirmMachineActionDialog } from './ConfirmMachineActionDialog.js';

const DOT_CLASS: Record<MachineTone, string> = {
  success: 'bg-success',
  muted: 'bg-muted-foreground',
  warning: 'bg-warning',
  info: 'bg-info',
  destructive: 'bg-destructive',
};

const TEXT_CLASS: Record<MachineTone, string> = {
  success: 'text-success',
  muted: 'text-muted-foreground',
  warning: 'text-warning',
  info: 'text-info',
  destructive: 'text-destructive',
};

function copyFingerprint(peerId: string): void {
  void navigator.clipboard.writeText(peerId);
  toast.success('Fingerprint copied');
}

/** One row of the machine list — the local machine, or a paired peer.
 *  See ux-machines.md §2. */
export function MachineRow({ machine }: { machine: MachineView }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(machine.label);
  const [confirmAction, setConfirmAction] = useState<
    'revoke' | 'remove' | null
  >(null);
  const rename = useRenameMachine();

  const presentation = machinePresentation(machine);
  const queueLabel = queueBadgeLabel(machine.queueDepth);

  const commitRename = () => {
    setEditing(false);
    const trimmed = value.trim();
    if (!trimmed || trimmed === machine.label) {
      setValue(machine.label);
      return;
    }
    rename.mutate(
      { peerId: machine.peerId, label: trimmed },
      {
        onSuccess: () => toast.success(`Renamed to ${trimmed}`),
        onError: (err: unknown) => {
          toast.error(errorMessage(err));
          setValue(machine.label);
        },
      }
    );
  };

  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span
        aria-hidden
        className={`size-2 shrink-0 rounded-full ${
          DOT_CLASS[presentation.tone]
        }`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {editing ? (
            <input
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') {
                  setValue(machine.label);
                  setEditing(false);
                }
              }}
              className="rounded border border-input bg-background px-1 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            />
          ) : (
            <Tip label="the name this machine goes by here">
              <span className="truncate font-medium">{machine.label}</span>
            </Tip>
          )}
          {machine.isLocal && <Badge variant="secondary">You</Badge>}
          {queueLabel && (
            <Tip label="Waiting to deliver">
              <Badge variant="warning">{queueLabel}</Badge>
            </Tip>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-sm">
          <span className={TEXT_CLASS[presentation.tone]}>
            {presentation.label}
          </span>
          {presentation.secondary && (
            <span className="truncate text-muted-foreground">
              {presentation.secondary}
            </span>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={() => copyFingerprint(machine.peerId)}
        className="hidden shrink-0 select-all rounded px-1 font-mono text-xs text-muted-foreground hover:bg-accent hover:text-foreground sm:block"
        title="Copy fingerprint"
      >
        {fingerprintGroups(machine.peerId)}
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Machine actions">
            <MoreHorizontalIcon className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setEditing(true)}>
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => copyFingerprint(machine.peerId)}>
            Copy fingerprint
          </DropdownMenuItem>
          {!machine.isLocal && machine.state !== 'revoked' && (
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => setConfirmAction('revoke')}
            >
              Revoke
            </DropdownMenuItem>
          )}
          {!machine.isLocal && (
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => setConfirmAction('remove')}
            >
              Remove
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {confirmAction && (
        <ConfirmMachineActionDialog
          action={confirmAction}
          machine={machine}
          onClose={() => setConfirmAction(null)}
        />
      )}
    </div>
  );
}
