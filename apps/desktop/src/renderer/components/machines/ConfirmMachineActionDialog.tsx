import { toast } from 'sonner';
import {
  useForgetMachine,
  useRevokeMachine,
} from '../../lib/data/mutations-machines.js';
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

/**
 * Revoke and Remove are both destructive, and both confirmed, but they
 * are not the same action — the confirm copy says how (ux-machines.md
 * §2): revoking keeps the record and refuses the peer, removing forgets
 * it entirely. Both leave the other machine's own sessions running.
 */
export function ConfirmMachineActionDialog({
  action,
  machine,
  onClose,
}: {
  action: 'revoke' | 'remove';
  machine: MachineView;
  onClose: () => void;
}) {
  const revoke = useRevokeMachine();
  const forget = useForgetMachine();
  const pending = action === 'revoke' ? revoke.isPending : forget.isPending;

  const confirm = () => {
    if (action === 'revoke') {
      revoke.mutate(machine.peerId, {
        onSuccess: () => {
          toast.success(`Revoked ${machine.label}`);
          onClose();
        },
        onError: (err: unknown) => toast.error(errorMessage(err)),
      });
    } else {
      forget.mutate(machine.peerId, {
        onSuccess: () => {
          toast.success(`Removed ${machine.label}`);
          onClose();
        },
        onError: (err: unknown) => toast.error(errorMessage(err)),
      });
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {action === 'revoke' ? 'Revoke' : 'Remove'} {machine.label}?
          </DialogTitle>
          <DialogDescription>
            {action === 'revoke' ? (
              <>
                The record stays, but this machine refuses{' '}
                <span className="font-medium text-foreground">
                  {machine.label}
                </span>{' '}
                from now on. You can re-pair it later.
              </>
            ) : (
              <>
                <span className="font-medium text-foreground">
                  {machine.label}
                </span>{' '}
                is forgotten entirely — pairing again starts from scratch.
              </>
            )}{' '}
            Either way, anything already running on {machine.label}&apos;s side
            keeps running.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={pending} onClick={confirm}>
            {action === 'revoke' ? 'Revoke' : 'Remove'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
