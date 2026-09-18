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
    revokedAt: null,
    // Inbound mail is addressed to this machine's peers, never to
    // itself; the main-process overlay (beam-mail-relay.ts, applied in
    // services/inbound-mail.ts) only ever fills these in for a peer row.
    inboundWaiting: [],
    inboundRefused: [],
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
    revokedAt: record.revokedAt ?? null,
    // Filled in by the main-process overlay, which knows peerId →
    // waiting/refused mail; the worker (where this view is built) has
    // no view of pty-registry to know either.
    inboundWaiting: [],
    inboundRefused: [],
  };
}
