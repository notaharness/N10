import { useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { BeamStatus, MachineView } from '../../../host/contract.js';
import { useBeamStatus, useMachines } from '../../lib/data/queries.js';
import { keys } from '../../lib/data/query-keys.js';
import { useFleet } from '../../lib/fleet/fleet-context.js';
import { publicationText } from '../../lib/fleet/publication.js';
import { cn, errorMessage } from '../../lib/utils.js';
import { MachineRow } from '../machines/MachineRow.js';
import { RevokeMachineDialog } from '../machines/RevokeMachineDialog.js';
import { Button } from '../ui/button.js';
import { Skeleton } from '../ui/skeleton.js';
import { EnrolmentFlow } from './EnrolmentFlow.js';
import { FirstRun } from './FirstRun.js';
import { FleetHeader } from './FleetHeader.js';
import { ResetFleetDialog } from './ResetFleetDialog.js';

function Card({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card">{children}</div>
  );
}

/** Until beam can answer for its fleet: its socket, then (`starting`)
 *  its transport, which every operation but `status` waits for. */
function Loading({ starting }: { starting: boolean }) {
  return (
    <Card>
      <div className="space-y-2 p-4" role="status">
        <p className="text-sm text-muted-foreground">
          {starting ? 'Preparing network…' : 'Connecting to beam…'}
        </p>
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

/** A banner of beam's own state above whatever Fleet shows. */
function Notice({
  warning = false,
  children,
}: {
  warning?: boolean;
  children: ReactNode;
}) {
  return (
    <p
      role="status"
      className={cn(
        'rounded-md border px-3 py-2 text-sm',
        warning
          ? 'border-warning/30 bg-warning/10'
          : 'border-border bg-muted/40'
      )}
    >
      {children}
    </p>
  );
}

/** This machine first, then the rest of its fleet. */
function FleetRows({
  machines,
  disabled,
}: {
  machines: MachineView[];
  disabled: boolean;
}) {
  const local = machines.find((m) => m.isLocal);
  const others = machines.filter((m) => !m.isLocal);
  return (
    <Card>
      <div className="divide-y divide-border">
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

/** Reconnecting, or an observed write still pending once the card
 *  that reported it has gone, while this machine is still enrolled. */
function StatusNotices({ beam }: { beam: BeamStatus }) {
  const { enrolment, revocation, publication } = useFleet();
  const cardShowing = enrolment.ceremony.view !== null || !!revocation.target;
  if (beam.state === 'restarting')
    return (
      <Notice warning>
        Reconnecting to beam… Machine information may be out of date.
      </Notice>
    );
  if (!publication.pending || cardShowing || !beam.enrolled) return null;
  return <Notice>{publicationText(false)}</Notice>;
}

/** Beam's machines once it answers: an enrolment under way or just
 *  ended, the first-run choices until this machine is in a fleet, and
 *  this machine's fleet once it is. */
function FleetBody({
  beam,
  machines,
  loadFailure,
}: {
  beam: BeamStatus;
  machines: MachineView[] | undefined;
  loadFailure: ReactNode;
}) {
  const { enrolment, revocation, reset } = useFleet();
  const reconnecting = beam.state === 'restarting';
  const enrolling = enrolment.ceremony.view !== null;
  return (
    <div className="space-y-4">
      {revocation.target && <RevokeMachineDialog machine={revocation.target} />}
      {reset.open && <ResetFleetDialog />}
      {beam.enrolled && (
        <FleetHeader
          fleetId={beam.fleetId}
          disabled={reconnecting || enrolment.ceremony.running}
          onReset={reset.show}
        />
      )}
      <StatusNotices beam={beam} />
      {loadFailure}
      {(enrolling || !beam.enrolled) && (
        <Card>
          <div className="p-4">
            {enrolling ? (
              <EnrolmentFlow />
            ) : (
              <FirstRun disabled={reconnecting} />
            )}
          </div>
        </Card>
      )}
      {beam.enrolled && (
        <FleetRows machines={machines ?? []} disabled={reconnecting} />
      )}
    </div>
  );
}

/** beam can answer for its fleet: connected, and past starting. */
function answering(beam: BeamStatus | undefined): beam is BeamStatus {
  return !!beam && beam.state !== 'connecting' && beam.state !== 'starting';
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
  if (!answering(beam) || machines.isLoading) {
    return <Loading starting={beam?.state === 'starting'} />;
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
