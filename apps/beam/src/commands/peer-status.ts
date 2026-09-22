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
  grantedScopes,
  STREAM_SCOPES,
  type PeerState,
  type StreamScope,
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
  /** Which stream kinds this peer may open here, with the legacy default
   * already applied — a record with no grant reports all three rather than
   * an absence the caller would have to interpret. */
  scopes: StreamScope[];
}

interface RawStatus {
  peerId: string;
  label: string;
  revoked: boolean;
  state: PeerState;
  queueDepth: number;
}

export async function collectPeerRows(io: Io): Promise<{
  rows: PeerRow[];
  nodeRunning: boolean;
  bindAddress: string | null;
}> {
  const beamDir = beamDirFor(io);
  const peers = new PeerTable(beamDir);
  const socket = await connectToRunningNode(inboxSocketPath(beamDir));

  let statuses: RawStatus[];
  let bindAddress: string | null = null;
  const nodeRunning = socket !== null;
  if (socket) {
    const response = await requestOnce(socket, { op: 'status' });
    socket.end();
    statuses = (response['peers'] as RawStatus[] | undefined) ?? [];
    bindAddress =
      typeof response['bindAddress'] === 'string'
        ? response['bindAddress']
        : null;
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

  const rows = statuses.map((status) => {
    const record = peers.get(status.peerId);
    return {
      ...status,
      endpoint: record?.endpoints[0] ?? '',
      scopes: [...grantedScopes(record)],
    };
  });
  return { rows, nodeRunning, bindAddress };
}

/** A grant, worded for a table: `all` rather than the full list, because
 * every peer paired before scopes existed and every peer paired without
 * `--grant` holds all three, and a column repeating that on every row
 * teaches the eye to skip it — which is the one row where it matters. */
export function describeScopes(scopes: readonly StreamScope[]): string {
  if (scopes.length === 0) return 'none';
  if (scopes.length === STREAM_SCOPES.length) return 'all';
  return scopes.join(',');
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
