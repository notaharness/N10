/**
 * Live PeerConnection registry, keyed by peerId. The host and the client
 * both feed connections through one of these so Phase 2's mailbox flusher
 * can find "is there a live connection to this peer right now" without
 * caring which side dialed it. See docs/beam.md.
 */

import type { PeerConnection } from './connection.js';

export class ConnectionRegistry {
  private connections = new Map<string, PeerConnection>();
  private connectHandlers: ((connection: PeerConnection) => void)[] = [];
  private disconnectHandlers: ((peerId: string) => void)[] = [];

  /** Register a live connection. A new connection to a peer that already
   * has one supersedes it — closing the old one — rather than leaking it. */
  add(connection: PeerConnection): void {
    this.connections.get(connection.peerId)?.close();
    this.connections.set(connection.peerId, connection);
    connection.onClose(() => {
      if (this.connections.get(connection.peerId) !== connection) return;
      this.connections.delete(connection.peerId);
      for (const cb of this.disconnectHandlers) cb(connection.peerId);
    });
    for (const cb of this.connectHandlers) cb(connection);
  }

  get(peerId: string): PeerConnection | undefined {
    return this.connections.get(peerId);
  }

  list(): PeerConnection[] {
    return [...this.connections.values()];
  }

  onConnect(cb: (connection: PeerConnection) => void): void {
    this.connectHandlers.push(cb);
  }

  onDisconnect(cb: (peerId: string) => void): void {
    this.disconnectHandlers.push(cb);
  }
}
