import { useFleet } from '../../lib/fleet/fleet-context.js';
import { useFocusOnMount } from '../../lib/fleet/use-focus-on-mount.js';
import { fingerprintGroups } from '../../lib/machines/machine-model.js';
import { Button } from '../ui/button.js';

/** The owner's report that the fingerprints differ, and the way out. */
function Mismatch({ onReset }: { onReset: () => void }) {
  const focus = useFocusOnMount<HTMLHeadingElement>();
  return (
    <div role="alert" className="space-y-2">
      <h3
        ref={focus}
        tabIndex={-1}
        className="font-medium text-destructive outline-none"
      >
        Fleet fingerprints do not match
      </h3>
      <p className="text-sm">
        This machine joined a different fleet. Stop using its remote
        connections. Reset the fleet on this machine, then join again using your
        known fleet passkey and a fresh link.
      </p>
      <Button size="sm" variant="destructive" onClick={onReset}>
        Reset fleet on this machine…
      </Button>
    </div>
  );
}

/**
 * After a join (beam-fleet-ux.md §2): the owner compares the fleet
 * fingerprint with a machine already in the fleet. This records their
 * answer for this session only; it verifies nothing and gates nothing,
 * since beam has already enrolled this machine.
 */
export function FingerprintCheck({ fleetId }: { fleetId: string }) {
  const { enrolment, reset } = useFleet();
  if (enrolment.mismatch) return <Mismatch onReset={reset.show} />;
  return (
    <div className="space-y-2 border-t border-border pt-3">
      <h4 className="font-medium">Check the fleet fingerprint</h4>
      <p className="font-mono text-base select-all">
        {fingerprintGroups(fleetId)}
      </p>
      <p className="text-sm text-muted-foreground">
        Compare this with Fleet on a machine already in your fleet, or run beam
        status there. Matching names are not enough.
      </p>
      <div className="flex gap-2">
        <Button size="sm" onClick={enrolment.leave}>
          Fingerprints match
        </Button>
        <Button size="sm" variant="outline" onClick={enrolment.reportMismatch}>
          They don’t match
        </Button>
      </div>
    </div>
  );
}
