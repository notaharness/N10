import { toast } from 'sonner';
import { useRevokeMachine } from '../../lib/data/mutations-machines.js';
import type { MachineView } from '../../../host/contract-machines.js';
import { errorMessage } from '../../lib/utils.js';
import { Button } from '../ui/button.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog.js';

/** Revoking is destructive, so it is confirmed first. It leaves the
 *  other machine's own sessions running. */
export function RevokeMachineDialog({
  machine,
  onClose,
}: {
  machine: MachineView;
  onClose: () => void;
}) {
  const revoke = useRevokeMachine();

  const confirm = () => {
    revoke.mutate(machine.peerId, {
      onSuccess: () => {
        toast.success(`Revoked ${machine.label}`);
        onClose();
      },
      onError: (err: unknown) => toast.error(errorMessage(err)),
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Revoke {machine.label}?</DialogTitle>
          <DialogDescription>
            <span className="font-medium text-foreground">{machine.label}</span>{' '}
            is refused from now on. Anything already running on {machine.label}
            &apos;s side keeps running.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={revoke.isPending}
            onClick={confirm}
          >
            Revoke
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
