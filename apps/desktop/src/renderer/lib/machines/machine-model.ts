import type {
  MachineState,
  MachineView,
} from '../../../host/contract-machines.js';
import { relativeTime } from '../utils.js';

/**
 * D6's five reachability states, plus `revoked`, mapped to what a row
 * actually shows — a pure function so the mapping is testable without
 * mounting anything, and so every state is exercised even though most
 * are rare in a screenshot. See the UX spec's table in
 * `ux-machines.md` — this is that table, in code.
 *
 * The two rules that matter most: `no-endpoint` is never a fault
 * (`info` tone, not `warning`/`destructive`), and `unknown` is never
 * rendered as `unreachable` — a paired machine that has not been
 * probed yet must read as "checking", not "down".
 */

export type MachineTone =
  | 'success'
  | 'muted'
  | 'warning'
  | 'info'
  | 'destructive';

export interface MachinePresentation {
  label: string;
  tone: MachineTone;
  secondary: string;
}

const STATE_LABEL: Record<MachineState, string> = {
  connected: 'Connected',
  reachable: 'Reachable',
  unreachable: 'Unreachable',
  unknown: 'Checking…',
  'no-endpoint': 'Can reach us only',
  revoked: 'Revoked',
};

const STATE_TONE: Record<MachineState, MachineTone> = {
  connected: 'success',
  reachable: 'muted',
  unreachable: 'warning',
  unknown: 'muted',
  'no-endpoint': 'info',
  revoked: 'destructive',
};

function secondaryText(machine: MachineView): string {
  switch (machine.state) {
    case 'connected':
      return machine.transport ?? '';
    case 'reachable':
      return machine.endpoints[0] ?? '';
    case 'unreachable':
      return machine.lastSeenAt == null
        ? 'never seen'
        : `last seen ${relativeTime(machine.lastSeenAt)}`;
    case 'unknown':
      return '';
    case 'no-endpoint':
      return 'this machine cannot be dialled from here';
    case 'revoked':
      return machine.revokedAt == null
        ? 'revoked'
        : `revoked ${relativeTime(machine.revokedAt)}`;
  }
}

export function machinePresentation(machine: MachineView): MachinePresentation {
  return {
    label: STATE_LABEL[machine.state],
    tone: STATE_TONE[machine.state],
    secondary: secondaryText(machine),
  };
}

/** `a1b2c3d4e5f60718` → `a1b2 c3d4 e5f6 0718` — grouped in fours, per
 *  the UX spec, so it is easier to compare out of band by eye. */
export function fingerprintGroups(peerId: string): string {
  const groups = peerId.match(/.{1,4}/g);
  return groups ? groups.join(' ') : peerId;
}

/** `9:41`-style countdown to a pairing token's expiry. Never negative —
 *  the caller shows the "generate a new code" affordance at `0:00`,
 *  not a clock running backwards. */
export function formatCountdown(msRemaining: number): string {
  const totalSeconds = Math.max(0, Math.ceil(msRemaining / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** `2 waiting`, or null when there is nothing to say — a zero queue
 *  shows no badge at all (the UX spec's copy rule: never call `queued`
 *  a failure, and never announce there being none of it either). */
export function queueBadgeLabel(depth: number): string | null {
  return depth > 0 ? `${depth} waiting` : null;
}
