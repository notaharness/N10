import type { MachineView } from '../contract-machines.js';
import { withMailOverlay } from './inbound-mail.js';

/**
 * The main-process face of the machines list. The transport behind it
 * is a port `main.ts` installs; this module owns nothing but the
 * request/response call and the cache the push channel keeps warm. No
 * `electron` import here, so this stays testable with a fake port.
 */
export interface MachinesPort {
  listMachines(): Promise<MachineView[]>;
  renameMachine(peerId: string, label: string): Promise<MachineView>;
  revokeMachine(peerId: string): Promise<MachineView>;
}

let port: MachinesPort | null = null;
let changed: ((machines: MachineView[]) => void) | null = null;
/** The last list any source (a call or a push) produced. */
let lastKnown: MachineView[] = [];

/** Installed by main.ts once the transport is up. */
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

/** Fed by the transport whenever it pushes a fresh list. Also the seam `refreshMailOverlay` calls when only inbound-mail
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
  if (!port) throw new Error('machines are not available yet');
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

export async function renameMachine(
  peerId: string,
  label: string
): Promise<MachineView> {
  return requirePort().renameMachine(peerId, label);
}

export async function revokeMachine(peerId: string): Promise<MachineView> {
  return requirePort().revokeMachine(peerId);
}
