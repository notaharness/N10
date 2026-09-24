import type {
  BeamStatus,
  CeremonyOutcome,
  CeremonyProgress,
  CeremonyRequest,
  FleetResetOutcome,
  MachineGrant,
  MachineView,
} from '../contract-machines.js';
import { withMailOverlay } from './inbound-mail.js';

/**
 * The main-process face of the machines list. The transport behind it
 * is a port `main.ts` installs; this module owns nothing but the
 * request/response call and the cache the push channel keeps warm. No
 * `electron` import here, so this stays testable with a fake port.
 */
export interface MachinesPort {
  listMachines(): Promise<MachineView[]>;
  setAlias(peerId: string, alias: string | null): Promise<void>;
  setGrant(peerId: string, grant: MachineGrant): Promise<void>;
  runCeremony(
    request: CeremonyRequest,
    onProgress: (progress: CeremonyProgress) => void
  ): Promise<CeremonyOutcome>;
  cancelCeremony(): Promise<void>;
  resetFleet(): Promise<FleetResetOutcome>;
}

let port: MachinesPort | null = null;
let changed: ((machines: MachineView[]) => void) | null = null;
let statusChanged: ((status: BeamStatus) => void) | null = null;
let ceremonyProgress: ((progress: CeremonyProgress) => void) | null = null;
/** The last list any source (a call or a push) produced. */
let lastKnown: MachineView[] = [];
let beamStatus: BeamStatus = {
  state: 'connecting',
  detail: null,
  enrolled: false,
};

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

export function setBeamStatusNotifier(
  fn: ((status: BeamStatus) => void) | null
): void {
  statusChanged = fn;
}

export function setCeremonyProgressNotifier(
  fn: ((progress: CeremonyProgress) => void) | null
): void {
  ceremonyProgress = fn;
}

/** Fed by the transport whenever it pushes a fresh list. Also the seam
 *  `refreshMailOverlay` calls when only inbound-mail state changed —
 *  `withMailOverlay` replaces its two fields wholesale, so re-running it
 *  on an already-merged list (`lastKnown`) is safe. */
export function receiveMachinesUpdate(machines: MachineView[]): void {
  lastKnown = withMailOverlay(machines);
  changed?.(lastKnown);
}

/** Called after a delivery, a refusal or a dismiss — an inbound-mail
 *  change with no beam change behind it, so nothing else would
 *  otherwise trigger a fresh push. */
export function refreshMailOverlay(): void {
  receiveMachinesUpdate(lastKnown);
}

export function getLastKnownMachines(): MachineView[] {
  return lastKnown;
}

/** Fed by the transport as its connection to the daemon changes. */
export function receiveBeamStatus(status: BeamStatus): void {
  beamStatus = status;
  statusChanged?.(status);
}

export async function getBeamStatus(): Promise<BeamStatus> {
  return beamStatus;
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

export async function setMachineAlias(
  peerId: string,
  alias: string | null
): Promise<void> {
  return requirePort().setAlias(peerId, alias);
}

export async function setMachineGrant(
  peerId: string,
  grant: MachineGrant
): Promise<void> {
  return requirePort().setGrant(peerId, grant);
}

export async function runCeremony(
  request: CeremonyRequest
): Promise<CeremonyOutcome> {
  return requirePort().runCeremony(request, (progress) =>
    ceremonyProgress?.(progress)
  );
}

export async function cancelCeremony(): Promise<void> {
  return requirePort().cancelCeremony();
}

export async function resetFleet(): Promise<FleetResetOutcome> {
  return requirePort().resetFleet();
}
