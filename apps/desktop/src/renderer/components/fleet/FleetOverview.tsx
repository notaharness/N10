import { useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type {
  BeamStatus,
  CeremonyOutcome,
  MachineView,
} from '../../../host/contract.js';
import { useBeamStatus, useMachines } from '../../lib/data/queries.js';
import { keys } from '../../lib/data/query-keys.js';
import { useFleet } from '../../lib/fleet/fleet-context.js';
import { ceremonyOutcomeText } from '../../lib/machines/ceremony-model.js';
import { errorMessage } from '../../lib/utils.js';
import { EnrolmentCard } from '../machines/EnrolmentCard.js';
import { MachineRow } from '../machines/MachineRow.js';
import { RevokeMachineDialog } from '../machines/RevokeMachineDialog.js';
import { Button } from '../ui/button.js';
import { Skeleton } from '../ui/skeleton.js';

function Card({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card">{children}</div>
  );
}

function Loading() {
  return (
    <Card>
      <div className="space-y-2 p-4" role="status">
        <p className="text-sm text-muted-foreground">Connecting to beam…</p>
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    </Card>
  );
}

/** A failure with its daemon detail as text, and the retry that can
 *  actually run. */
function Failure({
  title,
  detail,
  action,
  onRetry,
}: {
  title: string;
  detail: string | null;
  action: string;
  onRetry: () => void;
}) {
  return (
    <Card>
      <div className="space-y-2 p-4" role="alert">
        <p className="text-sm font-medium text-destructive">{title}</p>
        {detail && (
          <p className="font-mono text-xs text-muted-foreground select-text">
            {detail}
          </p>
        )}
        <Button size="sm" variant="outline" onClick={onRetry}>
          {action}
        </Button>
      </div>
    </Card>
  );
}

function Reconnecting() {
  return (
    <p
      role="status"
      className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm"
    >
      Reconnecting to beam… Machine information may be out of date.
    </p>
  );
}

/** This machine and its fleet, after the enrolment that just finished
 *  (if any) — a join's fleet fingerprint is what the owner compares. */
function FleetRows({
  machines,
  enrolled,
  disabled,
}: {
  machines: MachineView[];
  enrolled: CeremonyOutcome | null;
  disabled: boolean;
}) {
  const local = machines.find((m) => m.isLocal);
  const others = machines.filter((m) => !m.isLocal);
  return (
    <Card>
      <div className="divide-y divide-border">
        {enrolled?.ok && (
          <p className="px-4 py-4 text-sm text-muted-foreground" role="status">
            {ceremonyOutcomeText(enrolled, { thisMachine: local?.label })}
            {enrolled.op === 'join' &&
              ' Check that this fleet fingerprint matches the one a machine already in your fleet shows.'}
          </p>
        )}
        {local && <MachineRow machine={local} disabled={disabled} />}
        {others.map((m) => (
          <MachineRow key={m.peerId} machine={m} disabled={disabled} />
        ))}
        {others.length === 0 && (
          <p className="px-4 py-4 text-sm text-muted-foreground">
            No other machines yet. Add a desktop or a headless machine.
          </p>
        )}
      </div>
    </Card>
  );
}

/** Beam's machines once it answers: the first-run choices until this
 *  machine is in a fleet, then this machine first and its fleet. */
function FleetBody({
  beam,
  machines,
  loadFailure,
}: {
  beam: BeamStatus;
  machines: MachineView[] | undefined;
  loadFailure: ReactNode;
}) {
  const { enrolment, revocation } = useFleet();
  const reconnecting = beam.state === 'restarting';
  return (
    <div className="space-y-4">
      {revocation.target && <RevokeMachineDialog machine={revocation.target} />}
      {reconnecting && <Reconnecting />}
      {loadFailure}
      {!beam.enrolled || enrolment.running ? (
        <section aria-labelledby="fleet-first-machine">
          <h2 id="fleet-first-machine" className="mb-3 text-lg font-semibold">
            Connect your first machine
          </h2>
          <Card>
            <EnrolmentCard ceremony={enrolment} disabled={reconnecting} />
          </Card>
        </section>
      ) : (
        <FleetRows
          machines={machines ?? []}
          enrolled={enrolment.outcome}
          disabled={reconnecting}
        />
      )}
    </div>
  );
}

/** Fleet's body behind beam's availability (beam-fleet-ux.md §1). */
export function FleetOverview() {
  const qc = useQueryClient();
  const status = useBeamStatus();
  const machines = useMachines();
  const retry = () => {
    void qc.invalidateQueries({ queryKey: keys.beamStatus });
    void qc.invalidateQueries({ queryKey: keys.machines });
  };

  const beam = status.data;
  if (status.isError || beam?.state === 'unavailable') {
    return (
      <Failure
        title="Cannot connect to beam."
        detail={beam?.detail ?? errorMessage(status.error)}
        action="Retry connection"
        onRetry={retry}
      />
    );
  }
  if (!beam || beam.state === 'connecting' || machines.isLoading) {
    return <Loading />;
  }
  const loadFailure = machines.isError && (
    <Failure
      title="Could not load machines."
      detail={errorMessage(machines.error)}
      action="Retry"
      onRetry={retry}
    />
  );
  if (loadFailure && !machines.data) return loadFailure;
  return (
    <FleetBody beam={beam} machines={machines.data} loadFailure={loadFailure} />
  );
}
