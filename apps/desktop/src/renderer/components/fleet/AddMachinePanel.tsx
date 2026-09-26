import { CopyIcon } from 'lucide-react';
import { copyText } from '../../lib/copy-text.js';
import { useFocusOnMount } from '../../lib/fleet/use-focus-on-mount.js';
import { Button } from '../ui/button.js';

const JOIN_COMMAND = 'beam join --label buildbox';

/**
 * How another machine joins this fleet (beam-fleet-ux.md §2): from its
 * own n10 Desktop, or with beam on a headless machine. Nothing runs
 * here; this machine is already enrolled, so the instructions sit in
 * the Fleet section beside the rows they will add to.
 */
export function AddMachinePanel({
  fingerprint,
  onClose,
}: {
  /** This fleet's fingerprint, grouped. */
  fingerprint: string;
  onClose: () => void;
}) {
  const heading = useFocusOnMount<HTMLHeadingElement>();
  return (
    <div className="space-y-3 text-sm">
      <div>
        <h3 ref={heading} tabIndex={-1} className="font-medium outline-none">
          Add a machine
        </h3>
        <p className="text-muted-foreground">
          Join it from that machine, with this fleet’s passkey.
        </p>
      </div>
      <section className="space-y-1">
        <h4 className="font-medium">Another desktop</h4>
        <p>
          Open n10 Desktop on the machine you want to add. In the sidebar’s
          Fleet section choose Join an existing fleet, then use this fleet’s
          passkey. Compare its fleet fingerprint with {fingerprint}.
        </p>
      </section>
      <section className="space-y-2">
        <h4 className="font-medium">Headless machine</h4>
        <p>On the machine you want to add, run:</p>
        <div className="flex items-center gap-1">
          <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 font-mono text-xs select-all">
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
          braille QR code and prints the URL below it. Over SSH it does not open
          a browser. Scan the QR with a compatible phone or open the printed URL
          on a device with your fleet passkey.
        </p>
      </section>
      <p className="text-muted-foreground">
        Compare the page’s action, machine name and machine fingerprint with the
        command you ran. After joining, run beam status on that machine and
        compare its fleet fingerprint with {fingerprint}.
      </p>
      <Button size="sm" onClick={onClose}>
        Done
      </Button>
    </div>
  );
}
