import { describe, expect, it, vi } from 'vitest';
import { ConnectionRegistry } from './connection-registry.js';
import type { PeerConnection } from './connection.js';

function fakeConnection(peerId: string): {
  conn: PeerConnection;
  triggerClose: () => void;
} {
  const closeHandlers: ((reason: string) => void)[] = [];
  const conn: PeerConnection = {
    peerId,
    openStream: vi.fn(),
    onStream: vi.fn(),
    onClose: (cb) => closeHandlers.push(cb),
    close: () => closeHandlers.forEach((h) => h('closed locally')),
    terminate: (reason) =>
      closeHandlers.forEach((h) => h(reason ?? 'terminated locally')),
    checkAlive: () => Promise.resolve(true),
  };
  return {
    conn,
    triggerClose: () => closeHandlers.forEach((h) => h('connection closed')),
  };
}

describe('ConnectionRegistry', () => {
  it('get() returns the connection registered for a peerId', () => {
    const registry = new ConnectionRegistry();
    const { conn } = fakeConnection('peer-a');
    registry.add(conn);
    expect(registry.get('peer-a')).toBe(conn);
  });

  it('list() returns every live connection', () => {
    const registry = new ConnectionRegistry();
    registry.add(fakeConnection('a').conn);
    registry.add(fakeConnection('b').conn);
    expect(
      registry
        .list()
        .map((c) => c.peerId)
        .sort()
    ).toEqual(['a', 'b']);
  });

  it('fires onConnect when a connection is added', () => {
    const registry = new ConnectionRegistry();
    const seen: string[] = [];
    registry.onConnect((c) => seen.push(c.peerId));
    registry.add(fakeConnection('a').conn);
    expect(seen).toEqual(['a']);
  });

  it('fires onDisconnect and drops the entry when the connection closes', () => {
    const registry = new ConnectionRegistry();
    const { conn, triggerClose } = fakeConnection('a');
    registry.add(conn);
    const seen: string[] = [];
    registry.onDisconnect((peerId) => seen.push(peerId));
    triggerClose();
    expect(seen).toEqual(['a']);
    expect(registry.get('a')).toBeUndefined();
  });

  it('a new connection to the same peer closes and supersedes the old one', () => {
    const registry = new ConnectionRegistry();
    const first = fakeConnection('a');
    const closeSpy = vi.spyOn(first.conn, 'close');
    registry.add(first.conn);
    const second = fakeConnection('a');
    registry.add(second.conn);
    expect(closeSpy).toHaveBeenCalled();
    expect(registry.get('a')).toBe(second.conn);
  });
});
