import type {
  CeremonyOutcome,
  MachineView,
} from '../../../host/contract-machines.js';
import { useFleet } from '../../lib/fleet/fleet-context.js';
import { publicationText } from '../../lib/fleet/publication.js';
import { fingerprintGroups } from '../../lib/machines/machine-model.js';
import { CeremonyFailure } from '../fleet/CeremonyFailure.js';
import { CeremonyProgress } from '../fleet/CeremonyProgress.js';
import { Button } from '../ui/button.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog.js';

function Revoked({
  machine,
  outcome,
}: {
  machine: MachineView;
  outcome: Extract<CeremonyOutcome, { op: 'revoke' }>;
}) {
  const published = useFleet().publication.isPublished(outcome);
  const label = machine.label;
  const n = outcome.acknowledgedBy;
  return (
    <div role="status" className="space-y-1 text-sm">
      <p className="font-medium">Revoked {label} on this machine.</p>
      <p className="text-muted-foreground">{publicationText(published)}</p>
      <p className="text-muted-foreground">
        Acknowledged by {n} peers. Offline peers learn when they connect.
      </p>
    </div>
  );
}

/** The dialog's body: the warning, the ceremony, or how it ended. */
function RevokeBody({
  machine,
  revoke,
  onClose,
}: {
  machine: MachineView;
  revoke: () => void;
  onClose: () => void;
}) {
  const label = machine.label;
  const { view, running, outcome, cancel } = useFleet().revocation.ceremony;
  if (view && running) {
    return (
      <CeremonyProgress view={view} cancelLabel="Cancel" onCancel={cancel} />
    );
  }
  if (outcome && !outcome.ok) {
    return (
      <CeremonyFailure
        op="revoke"
        code={outcome.code}
        detail={outcome.detail}
        handlers={{ retry: revoke, close: onClose }}
      />
    );
  }
  if (outcome?.ok && outcome.op === 'revoke') {
    return (
      <>
        <Revoked machine={machine} outcome={outcome} />
        <DialogFooter>
          <Button onClick={onClose}>Close</Button>
        </DialogFooter>
      </>
    );
  }
  return (
    <>
      <p className="text-sm">
        Permanently remove {label} from this fleet. Your passkey signs the
        revocation. Connections to this machine close; offline peers learn when
        they reconnect. This does not erase files or guarantee that programs on
        that machine stop. A revoked machine needs a new node identity to
        return; fleet reset alone keeps its identity.
      </p>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="destructive" onClick={revoke}>
          Continue to passkey
        </Button>
      </DialogFooter>
    </>
  );
}

/**
 * Revoking removes a machine from the fleet for good, signed by the
 * owner's passkey (beam-fleet-ux.md §3). While it runs the dialog
 * cannot be dismissed; **Cancel** cancels it explicitly. A failure
 * offers **Try again**, never replays it on its own.
 */
export function RevokeMachineDialog({ machine }: { machine: MachineView }) {
  const { ceremony, close } = useFleet().revocation;
  const { running, start, reset } = ceremony;
  const onClose = () => {
    reset();
    close();
  };
  const revoke = () => start({ op: 'revoke', peerId: machine.peerId });

  return (
    <Dialog open onOpenChange={(o) => !o && !running && onClose()}>
      <DialogContent showCloseButton={!running}>
        <DialogHeader>
          <DialogTitle>Revoke {machine.label}</DialogTitle>
          <DialogDescription>
            Machine fingerprint{' '}
            <span className="font-mono text-foreground select-all">
              {fingerprintGroups(machine.peerId)}
            </span>
          </DialogDescription>
        </DialogHeader>
        <RevokeBody machine={machine} revoke={revoke} onClose={onClose} />
      </DialogContent>
    </Dialog>
  );
}
