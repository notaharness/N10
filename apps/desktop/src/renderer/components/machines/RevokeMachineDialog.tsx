import type { MachineView } from '../../../host/contract-machines.js';
import { useMachines } from '../../lib/data/queries.js';
import { ceremonyOutcomeText } from '../../lib/machines/ceremony-model.js';
import { isFleetMember } from '../../lib/machines/machine-model.js';
import { useCeremony } from '../../lib/machines/use-ceremony.js';
import { Button } from '../ui/button.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog.js';
import { CeremonyPanel } from './CeremonyPanel.js';

/** Members other than `peerId` a revocation could reach. */
function otherMembers(machines: MachineView[], peerId: string): number {
  return machines.filter((m) => isFleetMember(m) && m.peerId !== peerId).length;
}

/**
 * Revoking removes a machine from the fleet for good, signed by the
 * owner's passkey (beam docs/02): it takes effect here at once, on
 * connected members within seconds, and on the rest when they next
 * connect. Anything already running on that machine keeps running.
 */
export function RevokeMachineDialog({
  machine,
  onClose,
}: {
  machine: MachineView;
  onClose: () => void;
}) {
  const machines = useMachines().data ?? [];
  const { view, running, outcome, start, cancel } = useCeremony();
  const started = running || outcome !== null;

  return (
    <Dialog open onOpenChange={(o) => !o && !running && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Revoke {machine.label}?</DialogTitle>
          <DialogDescription>
            <span className="font-medium text-foreground">{machine.label}</span>{' '}
            leaves your fleet for good; it can only come back as a new machine.
            Your passkey signs the revocation. Anything already running on{' '}
            {machine.label}&apos;s side keeps running.
          </DialogDescription>
        </DialogHeader>
        {started && (
          <CeremonyPanel
            view={view}
            running={running}
            outcome={outcome}
            outcomeText={
              outcome
                ? ceremonyOutcomeText(outcome, {
                    others: otherMembers(machines, machine.peerId),
                  })
                : null
            }
            onCancel={cancel}
          />
        )}
        <DialogFooter>
          {!started && (
            <>
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => start({ op: 'revoke', peerId: machine.peerId })}
              >
                Revoke
              </Button>
            </>
          )}
          {outcome && <Button onClick={onClose}>Done</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
