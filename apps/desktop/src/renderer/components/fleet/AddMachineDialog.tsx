import { CopyIcon } from 'lucide-react';
import { copyText } from '../../lib/copy-text.js';
import { Button } from '../ui/button.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog.js';

const JOIN_COMMAND = 'beam join --label buildbox';

/**
 * How another machine joins this fleet (beam-fleet-ux.md §2): from its
 * own n10 Desktop, or with beam on a headless machine. Nothing runs
 * here; this machine is already enrolled.
 */
export function AddMachineDialog({
  fingerprint,
  onClose,
}: {
  /** This fleet's fingerprint, grouped. */
  fingerprint: string;
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a machine</DialogTitle>
          <DialogDescription>
            Join it from that machine, with this fleet’s passkey.
          </DialogDescription>
        </DialogHeader>
        <section className="space-y-1 text-sm">
          <h3 className="font-medium">Another desktop</h3>
          <p>
            Open n10 Desktop on the machine you want to add. Choose Fleet → Join
            an existing fleet, then use this fleet’s passkey. Compare its fleet
            fingerprint with {fingerprint}.
          </p>
        </section>
        <section className="space-y-2 text-sm">
          <h3 className="font-medium">Headless machine</h3>
          <p>On the machine you want to add, run:</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded bg-muted px-2 py-1 font-mono select-all">
              {JOIN_COMMAND}
            </code>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Copy command"
              onClick={() => copyText(JOIN_COMMAND, 'Command copied')}
            >
              <CopyIcon />
            </Button>
          </div>
          <p>
            Use your installed beam CLI. In an interactive terminal it draws a
            braille QR code and prints the URL below it. Over SSH it does not
            open a browser. Scan the QR with a compatible phone or open the
            printed URL on a device with your fleet passkey.
          </p>
        </section>
        <p className="text-sm text-muted-foreground">
          Compare the page’s action, machine name and machine fingerprint with
          the command you ran. After joining, run beam status on that machine
          and compare its fleet fingerprint with {fingerprint}.
        </p>
        <DialogFooter>
          <Button onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
