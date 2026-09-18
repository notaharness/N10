import type {
  AcceptingStatus,
  MachineView,
  PairConfirmResult,
  PairPreviewResult,
} from '../contract-machines.js';
import { withMailOverlay } from './inbound-mail.js';

/**
 * The main-process face of the beam node. Every real machine belongs to
 * the node running inside the utility process (decisions.md D10) — this
 * module owns nothing but the request/response call and the cache the
 * push channel keeps warm, exactly the way `services/desktop-prefs.ts`
 * and friends own nothing but Node, with Electron glue injected by
 * `main.ts`. No `electron` import here, so this stays testable with a
 * fake port and no utility process at all.
 */
export interface MachinesPort {
  listMachines(): Promise<MachineView[]>;
  getAcceptingStatus(): Promise<AcceptingStatus>;
  setAccepting(enabled: boolean): Promise<AcceptingStatus>;
  regeneratePairingUrl(): Promise<AcceptingStatus>;
  previewPairing(url: string): Promise<PairPreviewResult>;
  confirmPairing(url: string, force: boolean): Promise<PairConfirmResult>;
  renameMachine(peerId: string, label: string): Promise<MachineView>;
  revokeMachine(peerId: string): Promise<MachineView>;
  forgetMachine(peerId: string): Promise<void>;
}

let port: MachinesPort | null = null;
let changed: ((machines: MachineView[]) => void) | null = null;
/** The last list any source (a call or a push) produced. Answers the
 *  question "what did we last know" for the bridge's crash synthesis
 *  (beam-node-bridge.ts) without a round trip to a worker that may not
 *  exist right now. */
let lastKnown: MachineView[] = [];

/** Installed by main.ts once the utility-process bridge is up. */
export function setMachinesPort(next: MachinesPort | null): void {
  port = next;
}

/** Installed by host-events.ts, mirroring every other service's push
 *  pattern (e.g. `setBabysitNotifier`). */
export function setMachinesNotifier(
  fn: ((machines: MachineView[]) => void) | null
): void {
  changed = fn;
}

/** Fed by the bridge whenever the node pushes a fresh list, and by the
 *  bridge's own crash-supervision synthesis (see beam-node-bridge.ts).
 *  Also the seam `refreshMailOverlay` calls when only inbound-mail
 *  state changed — `withMailOverlay` replaces its two fields wholesale,
 *  so re-running it on an already-merged list (`lastKnown`) is safe. */
export function receiveMachinesUpdate(machines: MachineView[]): void {
  lastKnown = withMailOverlay(machines);
  changed?.(lastKnown);
}

/** Called after a delivery, a refusal or a dismiss — an inbound-mail
 *  change with no beam connection change behind it, so nothing else
 *  would otherwise trigger a fresh push. */
export function refreshMailOverlay(): void {
  receiveMachinesUpdate(lastKnown);
}

export function getLastKnownMachines(): MachineView[] {
  return lastKnown;
}

function requirePort(): MachinesPort {
  if (!port) throw new Error('the beam node is not available yet');
  return port;
}

export async function listMachines(): Promise<MachineView[]> {
  const machines = await requirePort().listMachines();
  lastKnown = withMailOverlay(machines);
  return lastKnown;
}

// `async` on every one of these, deliberately: `requirePort()`'s throw
// (no port installed yet) must become a rejected promise, not a
// synchronous throw out of what every caller treats as a Promise-
// returning function — register-handlers.ts awaits these directly.

export async function getAcceptingStatus(): Promise<AcceptingStatus> {
  return requirePort().getAcceptingStatus();
}

export async function setAccepting(enabled: boolean): Promise<AcceptingStatus> {
  return requirePort().setAccepting(enabled);
}

export async function regeneratePairingUrl(): Promise<AcceptingStatus> {
  return requirePort().regeneratePairingUrl();
}

export async function previewPairing(url: string): Promise<PairPreviewResult> {
  return requirePort().previewPairing(url);
}

export async function confirmPairing(
  url: string,
  force: boolean
): Promise<PairConfirmResult> {
  return requirePort().confirmPairing(url, force);
}

export async function renameMachine(
  peerId: string,
  label: string
): Promise<MachineView> {
  return requirePort().renameMachine(peerId, label);
}

export async function revokeMachine(peerId: string): Promise<MachineView> {
  return requirePort().revokeMachine(peerId);
}

export async function forgetMachine(peerId: string): Promise<void> {
  return requirePort().forgetMachine(peerId);
}
