import type { BeamStatus, MachineView } from '../../../host/contract.js';
import { machinesSummary } from '../machines/machine-model.js';

export type SummaryTone = 'muted' | 'warning' | 'active';

/**
 * The Fleet section header's one-line state, readable while the
 * section is collapsed: a passkey step waiting on the owner comes
 * first, since nothing else on screen says a request is outstanding.
 */
export function fleetSectionSummary({
  beam,
  machines,
  awaitingPasskey,
}: {
  beam: BeamStatus | undefined;
  machines: readonly MachineView[] | undefined;
  awaitingPasskey: boolean;
}): { text: string; tone: SummaryTone } | null {
  if (awaitingPasskey) return { text: 'Passkey step', tone: 'active' };
  if (!beam || beam.state === 'connecting' || beam.state === 'starting') {
    return null;
  }
  if (beam.state === 'unavailable') {
    return { text: 'Unavailable', tone: 'warning' };
  }
  if (!beam.enrolled) return { text: 'Not set up', tone: 'muted' };
  const summary = machinesSummary(machines ?? []);
  if (!summary) return { text: 'This machine', tone: 'muted' };
  return { text: summary.text, tone: summary.offline ? 'warning' : 'muted' };
}
