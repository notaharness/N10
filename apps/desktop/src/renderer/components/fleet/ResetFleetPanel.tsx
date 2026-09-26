import { failureCopy } from '../../lib/fleet/ceremony-errors.js';
import { useFleet } from '../../lib/fleet/fleet-context.js';
import { useFocusOnMount } from '../../lib/fleet/use-focus-on-mount.js';
import { Button } from '../ui/button.js';
import { Input } from '../ui/input.js';
import { Label } from '../ui/label.js';

/**
 * Reset fleet on this machine (beam-fleet-ux.md §3): beam's
 * `fleet.reset`, behind the word `reset` typed exactly. Inline in the
 * Fleet section: it has no passkey step, and the typed word already
 * asks for the owner's attention. A refusal keeps what was typed.
 */
export function ResetFleetPanel() {
  const { typed, busy, outcome, close, setTyped, run } = useFleet().reset;
  const heading = useFocusOnMount<HTMLHeadingElement>();
  return (
    <div className="space-y-3 text-sm">
      <h3 ref={heading} tabIndex={-1} className="font-medium outline-none">
        Reset fleet on this machine?
      </h3>
      <p className="text-muted-foreground">
        Disconnect this machine and remove its local fleet membership, known
        peers, revocations and pending directory writes. Queued messages to
        those peers are removed. Its machine identity is kept. Other machines
        and the fleet passkey are not reset or revoked.
      </p>
      {outcome?.ok ? (
        <>
          <p role="status">
            Fleet reset on this machine. Create a fleet or join one to continue.
          </p>
          <Button size="sm" onClick={close}>
            Close
          </Button>
        </>
      ) : (
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            run();
          }}
        >
          <p className="text-muted-foreground">
            Existing connections may still work, but adding or revoking machines
            needs the original passkey. Resetting here does not recover it.
          </p>
          <div className="grid gap-1.5">
            <Label htmlFor="fleet-reset-confirm">Type reset to confirm</Label>
            <Input
              id="fleet-reset-confirm"
              value={typed}
              autoComplete="off"
              disabled={busy}
              onChange={(e) => setTyped(e.target.value)}
            />
          </div>
          {outcome && (
            <p role="alert" className="text-destructive">
              Could not reset this machine’s fleet.{' '}
              {outcome.detail ?? failureCopy(outcome.code).explanation}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              size="sm"
              variant="destructive"
              disabled={busy || typed !== 'reset'}
            >
              {busy ? 'Resetting fleet…' : 'Reset fleet'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={close}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
