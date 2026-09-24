import { failureCopy } from '../../lib/fleet/ceremony-errors.js';
import { useFleet } from '../../lib/fleet/fleet-context.js';
import { Button } from '../ui/button.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog.js';
import { Input } from '../ui/input.js';
import { Label } from '../ui/label.js';

/**
 * Reset fleet on this machine (beam-fleet-ux.md §3): beam's
 * `fleet.reset`, behind the word `reset` typed exactly. A refusal
 * keeps what was typed.
 */
export function ResetFleetDialog() {
  const { typed, busy, outcome, close, setTyped, run } = useFleet().reset;
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && close()}>
      <DialogContent showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>Reset fleet on this machine?</DialogTitle>
          <DialogDescription>
            Disconnect this machine and remove its local fleet membership, known
            peers, revocations and pending directory writes. Queued messages to
            those peers are removed. Its machine identity is kept. Other
            machines and the fleet passkey are not reset or revoked.
          </DialogDescription>
        </DialogHeader>
        {outcome?.ok ? (
          <>
            <p role="status" className="text-sm">
              Fleet reset on this machine. Create a fleet or join one to
              continue.
            </p>
            <DialogFooter>
              <Button onClick={close}>Close</Button>
            </DialogFooter>
          </>
        ) : (
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              run();
            }}
          >
            <p className="text-sm text-muted-foreground">
              Existing connections may still work, but adding or revoking
              machines needs the original passkey. Resetting here does not
              recover it.
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
              <p role="alert" className="text-sm text-destructive">
                Could not reset this machine’s fleet.{' '}
                {outcome.detail ?? failureCopy(outcome.code).explanation}
              </p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={close}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="destructive"
                disabled={busy || typed !== 'reset'}
              >
                {busy ? 'Resetting fleet…' : 'Reset fleet'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
