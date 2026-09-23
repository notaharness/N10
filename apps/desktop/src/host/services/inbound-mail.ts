import type { InboundMailItem, MachineView } from '../contract-machines.js';

/**
 * The main-process face of the inbound mail relay: a per-machine
 * snapshot of waiting/refused mail, overlaid onto every `MachineView`
 * `services/machines.ts` produces, plus the one write — dismissing a
 * refused item. No Electron import, mirroring
 * `services/remote-machines.ts`'s port pattern, so this is testable
 * with a fake port.
 */
export interface InboundMailPort {
  snapshotFor(peerId: string): {
    inboundWaiting: InboundMailItem[];
    inboundRefused: InboundMailItem[];
  };
  dismiss(id: string): void;
}

let port: InboundMailPort | null = null;
/** Installed once the relay is constructed. `null` (the
 *  default, and what tests reset to) means "nothing waiting or
 *  refused" — every `MachineView` still renders, just with empty
 *  overlays, rather than throwing. */
export function setInboundMailPort(next: InboundMailPort | null): void {
  port = next;
}

function emptyOverlay(): {
  inboundWaiting: InboundMailItem[];
  inboundRefused: InboundMailItem[];
} {
  return { inboundWaiting: [], inboundRefused: [] };
}

/** Idempotent: re-applying this to an already-overlaid list just
 *  recomputes the same two fields, since they are replaced wholesale
 *  rather than merged — safe to call on `machines.ts`'s own cached,
 *  already-merged `lastKnown` when only the mail state changed. */
export function withMailOverlay(machines: MachineView[]): MachineView[] {
  if (!port) return machines;
  return machines.map((m) => ({
    ...m,
    ...(port?.snapshotFor(m.peerId) ?? emptyOverlay()),
  }));
}

export async function dismissInboundMail(id: string): Promise<void> {
  if (!port) throw new Error('inbound mail is not available yet');
  port.dismiss(id);
}
