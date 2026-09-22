/**
 * The IPC socket's peer-administration ops (docs/beam.md's local IPC
 * section): `revoke`, `rename`, `forget` and `reload-peers`.
 *
 * They act on the running node's own live `PeerTable` and
 * `ConnectionRegistry` — the same instances its `Host` and `Mailbox`
 * already hold — so a change is visible to auth and delivery immediately
 * rather than only after a restart re-reads `peers.json`.
 */

import type { Socket } from 'node:net';
import type { ConnectionRegistry } from './connection-registry.js';
import { writeLine } from './ipc-line.js';
import type { PeerTable } from './peer-table.js';

export interface PeerOpContext {
  peers: PeerTable;
  connections: ConnectionRegistry;
}

export function handleRevoke(
  ctx: PeerOpContext,
  socket: Socket,
  record: Record<string, unknown>
): void {
  const peerId = record['peer'];
  if (typeof peerId !== 'string') {
    writeLine(socket, { status: 'error', reason: 'malformed revoke request' });
    return;
  }
  try {
    ctx.peers.revoke(peerId);
  } catch (error) {
    writeLine(socket, { status: 'error', reason: (error as Error).message });
    return;
  }
  // A revoke that does not close an already-open connection (and, with it,
  // every stream on it) is not really a revoke — same rule as Host.revoke,
  // applied here so it also takes effect through the local socket, not only
  // through a peer dialing in fresh. `terminate` rather than `close`: a
  // graceful close asks the peer to agree, and the peer being revoked is
  // exactly the one with a reason not to.
  ctx.connections.get(peerId)?.terminate('peer revoked');
  writeLine(socket, { status: 'ok' });
}

export function handleRename(
  ctx: PeerOpContext,
  socket: Socket,
  record: Record<string, unknown>
): void {
  const peerId = record['peer'];
  const label = record['label'];
  if (typeof peerId !== 'string' || typeof label !== 'string') {
    writeLine(socket, { status: 'error', reason: 'malformed rename request' });
    return;
  }
  try {
    const updated = ctx.peers.rename(peerId, label);
    writeLine(socket, { status: 'ok', label: updated.label });
  } catch (error) {
    writeLine(socket, { status: 'error', reason: (error as Error).message });
  }
}

export function handleForget(
  ctx: PeerOpContext,
  socket: Socket,
  record: Record<string, unknown>
): void {
  const peerId = record['peer'];
  if (typeof peerId !== 'string') {
    writeLine(socket, { status: 'error', reason: 'malformed forget request' });
    return;
  }
  ctx.peers.remove(peerId);
  ctx.connections.get(peerId)?.terminate('peer forgotten');
  writeLine(socket, { status: 'ok' });
}

export function handleReloadPeers(ctx: PeerOpContext, socket: Socket): void {
  ctx.peers.reload();
  // `reload-peers` is the cross-process path: a separate CLI invocation
  // wrote `peers.json`, and that write may have revoked or removed a peer
  // this node still holds a live connection to. Leaving that connection —
  // and every stream on it, including a running shell — up until it
  // happens to drop is not really a revocation, which is the rule
  // `handleRevoke` and `Host.revoke` already apply on their own paths.
  for (const connection of ctx.connections.list()) {
    const peer = ctx.peers.get(connection.peerId);
    if (!peer || peer.revoked) connection.terminate('peer revoked');
  }
  writeLine(socket, { status: 'ok' });
}
