import type { LaunchStep } from '../../../host/contract-events.js';
import type {
  InboundMailItem,
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

// ── Phase 8: inbound mail relay (docs/beam.md, decisions.md D13/D14) ──
//
// A report from this machine that is waiting for its target session to
// connect, or one that was refused, oldest-first. Never a failure for
// `waiting` (ux-machines.md §7's rule extends to this: "queued" is not
// a failure, and neither is waiting for a pane to reconnect); a
// refusal is always visible and named — machine label, target, reason.

/** `1 waiting to be delivered` / `3 waiting to be delivered`, or null
 *  when there is nothing waiting — same "no badge at zero" rule as
 *  `queueBadgeLabel`. */
export function inboundWaitingBadgeLabel(machine: MachineView): string | null {
  const n = machine.inboundWaiting.length;
  return n > 0 ? `${n} waiting to be delivered` : null;
}

/** `1 refused` / `2 refused`, or null when there is nothing refused. */
export function inboundRefusedBadgeLabel(machine: MachineView): string | null {
  const n = machine.inboundRefused.length;
  return n > 0 ? `${n} refused` : null;
}

export interface InboundMailRow {
  id: string;
  target: string;
  reason?: string;
  age: string;
}

/** Oldest first, formatted for display — the rows a machine row's
 *  expandable inbound-mail panel renders. */
export function inboundMailRows(
  items: readonly InboundMailItem[]
): InboundMailRow[] {
  return [...items]
    .sort((a, b) => a.receivedAt - b.receivedAt)
    .map((i) => ({
      id: i.id,
      target: i.target,
      reason: i.reason,
      age: relativeTime(i.receivedAt),
    }));
}

/** The oldest item's age across both waiting and refused mail, for a
 *  one-line summary beside the badges — `null` when there is nothing
 *  from this machine at all. */
export function oldestInboundMailAge(machine: MachineView): string | null {
  const all = [...machine.inboundWaiting, ...machine.inboundRefused];
  if (all.length === 0) return null;
  return relativeTime(Math.min(...all.map((i) => i.receivedAt)));
}

// ── Phase 7: launching on a machine (ux-machines.md §5, §6) ────────

/** D8's gate for every surface this phase adds: with only the local
 *  machine registered, none of it renders. */
export function hasPeerMachines(machines: readonly MachineView[]): boolean {
  return machines.some((m) => !m.isLocal);
}

/** Whether a machine can be launched on right now — the local machine
 *  always can; a peer needs a live or provenly-reachable connection.
 *  `no-endpoint`/`unknown`/`unreachable`/`revoked` are listed but not
 *  selectable — ux-machines.md §5: shown disabled with the reason,
 *  never omitted, so a user who paired a machine and cannot find it
 *  selectable still finds the row and learns why. */
export function isMachineSelectable(machine: MachineView): boolean {
  return (
    machine.isLocal ||
    machine.state === 'connected' ||
    machine.state === 'reachable'
  );
}

/** What a dialog's machine picker should show, and what its launch
 *  should name: `value` is the row the `Select` renders as chosen,
 *  `remote` the peerId a launch request carries (`undefined` for a
 *  local launch, which is every launch whose machine is this one).
 *
 *  A dialog can sit open while the machine it picked flips to
 *  `unreachable` or `revoked`. Radix disables that option but keeps
 *  the value, so a stale pick would still go out on the request and
 *  fail a round trip later. Falling back to local is both what gets
 *  sent and what the picker shows, so the two never disagree about
 *  which machine is about to be used. */
export function machineChoice(
  machines: readonly MachineView[],
  chosen: string | null
): { value: string; remote: string | undefined } {
  const local = machines.find((m) => m.isLocal);
  const picked = chosen
    ? machines.find((m) => m.peerId === chosen && isMachineSelectable(m))
    : undefined;
  const value = (picked ?? local)?.peerId ?? '';
  const remote =
    hasPeerMachines(machines) && value && value !== local?.peerId
      ? value
      : undefined;
  return { value, remote };
}

export interface MachineOption {
  machine: MachineView;
  disabled: boolean;
  /** Shown beside a disabled option; null only when the option is
   *  enabled. Never a bare omission for a disabled one. */
  reason: string | null;
}

/** The machine `Select`'s rows: local first (as `useMachines` already
 *  orders them), every peer listed — reachable ones enabled, everything
 *  else disabled with its D6 state spelled out beside it. */
export function machineSelectOptions(
  machines: readonly MachineView[]
): MachineOption[] {
  return machines.map((machine) => {
    if (isMachineSelectable(machine))
      return { machine, disabled: false, reason: null };
    const p = machinePresentation(machine);
    return {
      machine,
      disabled: true,
      reason: p.secondary ? `${p.label} — ${p.secondary}` : p.label,
    };
  });
}

/** A machine id (D2's beam `peerId`, or `'local'`/absent) resolved to
 *  its label for display — never a bare id, which means nothing to the
 *  user. `null` for local: the caller shows no prefix/badge at all.
 *  A machine no longer in the registered list (revoked, removed) still
 *  has to render something honest, so this names it rather than
 *  vanishing or showing the raw id. */
export function resolveMachineLabel(
  machineId: string | undefined,
  machines: readonly MachineView[] | undefined
): string | null {
  if (!machineId || machineId === 'local') return null;
  const found = machines?.find((m) => m.peerId === machineId);
  return found ? found.label : 'Unknown machine';
}

/** "Creating worktree on workbox…" / "Starting claude…" — the step
 *  vocabulary is closed and structural (host side); the copy lives
 *  here so it reads naturally for whatever is being started. `what` is
 *  the agent's name, or "shell"/"agent" for a plain terminal. */
export function launchStepLabel(
  step: LaunchStep,
  machineLabel: string,
  what: string
): string {
  return step === 'worktree'
    ? `Creating worktree on ${machineLabel}…`
    : `Starting ${what}…`;
}
