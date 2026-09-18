/**
 * Shared "what does every peer look like right now" logic behind `peers`
 * and `status`: prefer the running node's own live view (over the local
 * IPC socket, which reflects real connections) and fall back to a
 * computed-from-disk view (D6's `derivePeerState`, this process's own empty
 * connection set) when no node is running.
 */

import {
  OutboundQueue,
  PeerTable,
  derivePeerState,
  type PeerState,
} from '@n10/beam';
import { beamDirFor, inboxSocketPath } from '../context.js';
import type { Io } from '../io.js';
import { connectToRunningNode, requestOnce } from '../ipc-client.js';

export interface PeerRow {
  peerId: string;
  label: string;
  state: PeerState;
  revoked: boolean;
  endpoint: string;
  queueDepth: number;
}

interface RawStatus {
  peerId: string;
  label: string;
  revoked: boolean;
  state: PeerState;
  queueDepth: number;
}

export async function collectPeerRows(
  io: Io
): Promise<{ rows: PeerRow[]; nodeRunning: boolean }> {
  const beamDir = beamDirFor(io);
  const peers = new PeerTable(beamDir);
  const socket = await connectToRunningNode(inboxSocketPath(beamDir));

  let statuses: RawStatus[];
  const nodeRunning = socket !== null;
  if (socket) {
    const response = await requestOnce(socket, { op: 'status' });
    socket.end();
    statuses = (response['peers'] as RawStatus[] | undefined) ?? [];
  } else {
    const queue = new OutboundQueue(beamDir);
    statuses = peers.list().map((peer) => ({
      peerId: peer.peerId,
      label: peer.label,
      revoked: peer.revoked,
      state: derivePeerState(peer, false),
      queueDepth: queue.depth(peer.peerId),
    }));
  }

  const rows = statuses.map((status) => ({
    ...status,
    endpoint: peers.get(status.peerId)?.endpoints[0] ?? '',
  }));
  return { rows, nodeRunning };
}

/** D6's states, worded for a human. `no-endpoint` is a normal condition
 * ("can reach us only"), never an error — it must not read like a fault. */
export function describeState(state: PeerState): string {
  switch (state) {
    case 'connected':
      return 'connected';
    case 'reachable':
      return 'reachable';
    case 'unreachable':
      return 'unreachable';
    case 'unknown':
      return 'unknown';
    case 'no-endpoint':
      return 'no-endpoint — can reach us only';
  }
}
