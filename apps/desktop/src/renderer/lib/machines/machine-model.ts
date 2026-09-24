import type { LaunchStep } from '../../../host/contract-events.js';
import type {
  InboundMailItem,
  MachineState,
  MachineView,
} from '../../../host/contract-machines.js';
import { relativeTime } from '../utils.js';

/**
 * beam's peer states mapped to what a row shows — a pure function so
 * the mapping is testable without mounting anything.
 */

export type MachineTone = 'success' | 'muted' | 'destructive';

export interface MachinePresentation {
  label: string;
  tone: MachineTone;
  secondary: string;
}

const STATE_LABEL: Record<MachineState, string> = {
  connected: 'Connected',
  offline: 'Offline',
  revoked: 'Revoked',
  'revoked-by-fleet': 'Refuses this machine',
};

const STATE_TONE: Record<MachineState, MachineTone> = {
  connected: 'success',
  offline: 'muted',
  revoked: 'destructive',
  'revoked-by-fleet': 'destructive',
};

function secondaryText(machine: MachineView): string {
  switch (machine.state) {
    case 'connected':
      return machine.isLocal ? '' : machine.path ?? '';
    case 'offline':
      return machine.lastSeenAt == null
        ? 'never seen'
        : `last seen ${relativeTime(machine.lastSeenAt)}`;
    case 'revoked':
      return machine.revokedAt == null
        ? 'revoked here'
        : `revoked ${relativeTime(machine.revokedAt)}`;
    case 'revoked-by-fleet':
      return 'it has revoked this machine';
  }
}

export function machinePresentation(machine: MachineView): MachinePresentation {
  return {
    label: STATE_LABEL[machine.state],
    tone: STATE_TONE[machine.state],
    secondary: secondaryText(machine),
  };
}

/** A peerId or fleetId as beam prints it: its first 16 characters in
 *  groups of four (`a1b2 c3d4 e5f6 0718`), for comparing by eye. */
export function fingerprintGroups(id: string): string {
  const groups = id.slice(0, 16).match(/.{1,4}/g);
  return groups ? groups.join(' ') : id;
}

/** `2 waiting`, or null at zero — mail queued for a peer is not a
 *  failure, and no badge shows for none. */
export function queueBadgeLabel(depth: number): string | null {
  return depth > 0 ? `${depth} waiting` : null;
}

// ── Inbound mail relay (decisions.md D13/D14) ──
//
// A report from this machine that is waiting for its target session to
// connect, or one that was refused, oldest-first. Waiting is not a
// failure; a refusal is always visible and named — machine label,
// target, reason.

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

// ── Launching on a machine ────────

/** D8's gate for every machines surface: with only the local machine
 *  registered, none of it renders. */
export function hasPeerMachines(machines: readonly MachineView[]): boolean {
  return machines.some((m) => !m.isLocal);
}

/** A peer still in the fleet: not this machine, not revoked here. */
export function isFleetMember(machine: MachineView): boolean {
  return !machine.isLocal && machine.state !== 'revoked';
}

/** Whether a machine can be launched on right now — this machine
 *  always can; a peer needs a live tunnel, and a grant here is not
 *  what decides that (its grant on *its* side does). Others are listed
 *  disabled with the reason, never omitted, so a user who cannot
 *  select a machine still finds its row and learns why. */
export function isMachineSelectable(machine: MachineView): boolean {
  return machine.isLocal || machine.state === 'connected';
}

/** What a dialog's machine picker should show, and what its launch
 *  should name: `value` is the row the `Select` renders as chosen,
 *  `remote` the peerId a launch request carries (`undefined` for a
 *  local launch, which is every launch whose machine is this one).
 *
 *  A dialog can sit open while the machine it picked flips to
 *  `offline` or `revoked`. Radix disables that option but keeps
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
 *  orders them), every peer listed — connected ones enabled, everything
 *  else disabled with its state spelled out beside it. */
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
 *  A machine no longer in the list still has to render something
 *  honest, so this names it rather than vanishing or showing the id. */
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
