import type {
  MachineGrant,
  MachineState,
  MachineView,
} from '../../host/contract-machines.js';

/** The fields of beam docs/06's `PeerView` this client reads. */
export interface PeerView {
  peerId: string;
  label: string;
  alias: string | null;
  state: string;
  path: string;
  lastSeenAt: number | null;
  grant: string;
  revokedAt: number | null;
  queue: { outbound: number };
}

/** The subset of beam docs/06's `status` result this client reads. */
export interface DaemonStatus {
  enrolled: boolean;
  peerId?: string;
  label?: string;
  fleetId?: string;
}

const STATES: readonly MachineState[] = [
  'connected',
  'offline',
  'revoked',
  'revoked-by-fleet',
];
const GRANTS: readonly MachineGrant[] = ['all', 'msg', 'none'];

function oneOf<T extends string>(
  allowed: readonly T[],
  value: string,
  fallback: T
): T {
  return (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

export function machineFromPeer(peer: PeerView): MachineView {
  return {
    peerId: peer.peerId,
    label: peer.alias ?? peer.label,
    isLocal: false,
    state: oneOf(STATES, peer.state, 'offline'),
    path: peer.path,
    lastSeenAt: peer.lastSeenAt,
    // beam reads a grant it cannot parse as none (docs/04); so does this.
    grant: oneOf(GRANTS, peer.grant, 'none'),
    revokedAt: peer.revokedAt,
    queued: peer.queue.outbound,
    inboundWaiting: [],
    inboundRefused: [],
  };
}

export function localMachine(status: DaemonStatus): MachineView {
  return {
    peerId: status.peerId ?? '',
    label: status.label ?? '',
    isLocal: true,
    state: 'connected',
    path: null,
    lastSeenAt: null,
    grant: 'all',
    revokedAt: null,
    queued: 0,
    inboundWaiting: [],
    inboundRefused: [],
  };
}

/** This machine first, then peers by label (then id, for a stable
 *  order among labels that collide). */
export function orderMachines(machines: MachineView[]): MachineView[] {
  return [...machines].sort(
    (a, b) =>
      Number(b.isLocal) - Number(a.isLocal) ||
      a.label.localeCompare(b.label) ||
      a.peerId.localeCompare(b.peerId)
  );
}

/** `list` with `peer` replacing its row, or added when it is new. */
export function mergePeer(list: MachineView[], peer: PeerView): MachineView[] {
  const next = machineFromPeer(peer);
  const rest = list.filter((m) => m.peerId !== next.peerId);
  return orderMachines([...rest, next]);
}
