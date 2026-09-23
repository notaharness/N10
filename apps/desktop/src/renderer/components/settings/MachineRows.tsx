import type {
  BeamStatus,
  CeremonyOutcome,
  MachineView,
} from '../../../host/contract.js';
import { useBeamStatus, useMachines } from '../../lib/data/queries.js';
import { ceremonyOutcomeText } from '../../lib/machines/ceremony-model.js';
import { useCeremony } from '../../lib/machines/use-ceremony.js';
import { EnrolmentCard } from '../machines/EnrolmentCard.js';
import { MachineRow } from '../machines/MachineRow.js';
import { Skeleton } from '../ui/skeleton.js';

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-4 py-4 text-sm text-muted-foreground" role="status">
      {children}
    </p>
  );
}

function statusNotice(status: BeamStatus): string | null {
  switch (status.state) {
    case 'unavailable':
      return status.detail ?? 'beam is not available.';
    case 'restarting':
      return 'beam restarting…';
    default:
      return null;
  }
}

function Loading() {
  return (
    <div className="space-y-2 p-4">
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
    </div>
  );
}

/** This machine and its fleet, after the enrolment that just finished
 *  (if any) — a join's fleet fingerprint is what the owner compares. */
function FleetRows({
  machines,
  notice,
  enrolled,
}: {
  machines: MachineView[];
  notice: string | null;
  enrolled: CeremonyOutcome | null;
}) {
  const local = machines.find((m) => m.isLocal);
  return (
    <div className="divide-y divide-border">
      {notice && <Notice>{notice}</Notice>}
      {enrolled?.ok && (
        <Notice>
          {ceremonyOutcomeText(enrolled, { thisMachine: local?.label })}
          {enrolled.op === 'join' &&
            ' Check that this fleet fingerprint matches the one a machine already in your fleet shows.'}
        </Notice>
      )}
      {machines.map((m) => (
        <MachineRow key={m.peerId} machine={m} />
      ))}
    </div>
  );
}

/**
 * The Machines settings group: the beam daemon's state, the enrolment
 * card until this machine is in a fleet, then this machine first and
 * its fleet after it. Repo-independent — see settings-groups.ts's
 * special case for this group, the same one `'appearance'` gets.
 */
export function MachineRows() {
  const status = useBeamStatus().data;
  const machines = useMachines();
  const ceremony = useCeremony();

  if (!status || status.state === 'connecting' || machines.isLoading) {
    return <Loading />;
  }
  const notice = statusNotice(status);
  if (notice && !status.enrolled) return <Notice>{notice}</Notice>;
  if (!status.enrolled || ceremony.running) {
    return <EnrolmentCard ceremony={ceremony} />;
  }
  return (
    <FleetRows
      machines={machines.data ?? []}
      notice={notice}
      enrolled={ceremony.outcome}
    />
  );
}
