import { useState } from 'react';
import { toast } from 'sonner';
import type { MachineTone } from '../../lib/machines/machine-model.js';
import {
  fingerprintGroups,
  inboundMailRows,
  inboundRefusedBadgeLabel,
  inboundWaitingBadgeLabel,
  machinePresentation,
  queueBadgeLabel,
} from '../../lib/machines/machine-model.js';
import { useSetMachineAlias } from '../../lib/data/mutations-machines.js';
import type { MachineView } from '../../../host/contract-machines.js';
import { errorMessage } from '../../lib/utils.js';
import { Badge } from '../ui/badge.js';
import { Tip } from '../ui/tooltip.js';
import { InboundMailPanel } from './InboundMailPanel.js';
import { MachineMenu, copyFingerprint } from './MachineMenu.js';
import { RevokeMachineDialog } from './RevokeMachineDialog.js';

const DOT_CLASS: Record<MachineTone, string> = {
  success: 'bg-success',
  muted: 'bg-muted-foreground',
  destructive: 'bg-destructive',
};

const TEXT_CLASS: Record<MachineTone, string> = {
  success: 'text-success',
  muted: 'text-muted-foreground',
  destructive: 'text-destructive',
};

/** The name a member goes by here, edited in place. An empty name
 *  clears the alias; an unchanged one sends nothing. */
function AliasInput({
  machine,
  onDone,
}: {
  machine: MachineView;
  onDone: () => void;
}) {
  const [value, setValue] = useState(machine.label);
  const setAlias = useSetMachineAlias();
  const commit = () => {
    onDone();
    const trimmed = value.trim();
    if (trimmed === machine.label) return;
    setAlias.mutate(
      { peerId: machine.peerId, alias: trimmed || null },
      { onError: (err: unknown) => toast.error(errorMessage(err)) }
    );
  };
  return (
    <input
      autoFocus
      aria-label="Name on this machine"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') onDone();
      }}
      className="rounded border border-input bg-background px-1 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
    />
  );
}

function RowBadges({ machine }: { machine: MachineView }) {
  const queueLabel = queueBadgeLabel(machine.queued);
  const waitingLabel = inboundWaitingBadgeLabel(machine);
  const refusedLabel = inboundRefusedBadgeLabel(machine);
  return (
    <>
      {machine.isLocal && <Badge variant="secondary">You</Badge>}
      {machine.grant !== 'all' && (
        <Tip label="What this machine may open here">
          <Badge variant="secondary">
            {machine.grant === 'msg' ? 'messages only' : 'no access'}
          </Badge>
        </Tip>
      )}
      {queueLabel && (
        <Tip label="Waiting to deliver">
          <Badge variant="warning">{queueLabel}</Badge>
        </Tip>
      )}
      {waitingLabel && (
        <Tip label="A report from this machine is waiting for its session to reconnect">
          <Badge variant="warning">{waitingLabel}</Badge>
        </Tip>
      )}
      {refusedLabel && (
        <Tip label="A report from this machine could not be delivered">
          <Badge variant="destructive">{refusedLabel}</Badge>
        </Tip>
      )}
    </>
  );
}

/** One row of the machine list — this machine, or a fleet member. */
export function MachineRow({ machine }: { machine: MachineView }) {
  const [editing, setEditing] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const presentation = machinePresentation(machine);

  return (
    <div data-testid="machine-row" data-peer-id={machine.peerId}>
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
              <AliasInput machine={machine} onDone={() => setEditing(false)} />
            ) : (
              <span className="truncate font-medium">{machine.label}</span>
            )}
            <RowBadges machine={machine} />
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

        <MachineMenu
          machine={machine}
          onRename={() => setEditing(true)}
          onRevoke={() => setRevoking(true)}
        />

        {revoking && (
          <RevokeMachineDialog
            machine={machine}
            onClose={() => setRevoking(false)}
          />
        )}
      </div>
      <InboundMailPanel
        waiting={inboundMailRows(machine.inboundWaiting)}
        refused={inboundMailRows(machine.inboundRefused)}
      />
    </div>
  );
}
