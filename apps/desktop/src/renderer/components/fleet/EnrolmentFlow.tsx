import type { CeremonyOutcome } from '../../../host/contract-machines.js';
import { useFleet } from '../../lib/fleet/fleet-context.js';
import { publicationText } from '../../lib/fleet/publication.js';
import { useFocusOnMount } from '../../lib/fleet/use-focus-on-mount.js';
import { fingerprintGroups } from '../../lib/machines/machine-model.js';
import { Button } from '../ui/button.js';
import { CeremonyFailure } from './CeremonyFailure.js';
import { CeremonyProgress, InitSteps } from './CeremonyProgress.js';
import { FingerprintCheck } from './FingerprintCheck.js';

function Success({
  outcome,
  onClose,
}: {
  outcome: Extract<CeremonyOutcome, { op: 'init' | 'join' }>;
  onClose: () => void;
}) {
  const focus = useFocusOnMount<HTMLHeadingElement>();
  const published = useFleet().publication.isPublished(outcome);
  return (
    <div className="space-y-2">
      <div className="space-y-2" role="status">
        {outcome.op === 'init' ? (
          <>
            <h3 ref={focus} tabIndex={-1} className="font-medium outline-none">
              Fleet created
            </h3>
            <p className="text-sm">
              This machine is enrolled. Use this fleet’s passkey to add your
              other machines.
            </p>
          </>
        ) : (
          <h3 ref={focus} tabIndex={-1} className="font-medium outline-none">
            Joined fleet {fingerprintGroups(outcome.fleetId)}. {outcome.members}{' '}
            other machines known; connecting…
          </h3>
        )}
        <p className="text-sm text-muted-foreground">
          {publicationText(published)}
        </p>
      </div>
      {outcome.op === 'join' ? (
        <FingerprintCheck fleetId={outcome.fleetId} />
      ) : (
        <Button size="sm" onClick={onClose}>
          Close
        </Button>
      )}
    </div>
  );
}

/**
 * A create or join under way or just ended: its progress, its outcome
 * with the next actions that can run, or its success.
 */
export function EnrolmentFlow() {
  const { enrolment } = useFleet();
  const { ceremony, submit, leave } = enrolment;
  const { view, running, outcome } = ceremony;
  if (!view) return null;
  if (running || !outcome) {
    return (
      <CeremonyProgress
        view={view}
        cancelLabel="Cancel setup"
        onCancel={ceremony.cancel}
      />
    );
  }
  // The host re-reads beam's status after every ceremony, failed ones
  // too, so what shows behind the result is already current.
  if (outcome.ok) {
    return outcome.op === 'revoke' ? null : (
      <Success outcome={outcome} onClose={leave} />
    );
  }
  return (
    <div className="space-y-4">
      {view.op === 'init' && <InitSteps view={view} failed />}
      <CeremonyFailure
        op={view.op}
        code={outcome.code}
        detail={outcome.detail}
        reachedPasskey={view.step > 0}
        handlers={{ retry: submit, back: ceremony.reset, close: leave }}
      />
    </div>
  );
}
