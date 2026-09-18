/**
 * Pure mapping from beam's own primitives to `MachineView` — split out
 * of `beam-node.ts` (a catalogue already) so the state derivation (D6's
 * five states plus `revoked`) is independently testable without a real
 * node, connection or timer.
 */
import { derivePeerState, type PeerRecord } from '@n10/beam';
import type { MachineState, MachineView } from '../host/contract-machines.js';

export function localMachineView(
  peerId: string,
  label: string,
  endpoints: string[]
): MachineView {
  return {
    peerId,
    label,
    isLocal: true,
    state: 'connected',
    transport: null,
    endpoints,
    lastSeenAt: null,
    queueDepth: 0,
    pairedAt: null,
  };
}

export function peerMachineView(
  status: {
    peerId: string;
    label: string;
    revoked: boolean;
    queueDepth: number;
  },
  record: PeerRecord,
  connected: boolean,
  probe?: 'reachable' | 'unreachable'
): MachineView {
  const state: MachineState = status.revoked
    ? 'revoked'
    : derivePeerState(record, connected, probe);
  return {
    peerId: status.peerId,
    label: status.label,
    isLocal: false,
    state,
    transport: connected ? 'WebSocket' : null,
    endpoints: record.endpoints,
    lastSeenAt: record.lastSeenAt ?? null,
    queueDepth: status.queueDepth,
    pairedAt: record.pairedAt,
  };
}
