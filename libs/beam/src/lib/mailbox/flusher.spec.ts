import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectionRegistry } from '../connection-registry.js';
import { createConnection } from '../connection.js';
import { StreamRegistry } from '../stream-registry.js';
import type { TransportSocket } from '../transport.js';
import { Flusher } from './flusher.js';
import { OutboundQueue } from './outbound-queue.js';

/** A real-shaped peer id: 16 lowercase hex characters, as `derivePeerId`
 * produces and as the queue's path boundary requires (identifiers.ts). */
const REVOKED_PEER = '00000000000000b0';
const PEER = '00000000000000c0';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'beam-flusher-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A TransportSocket that never actually does anything — enough for a
 * PeerConnection to exist and be registered; nothing in these tests reaches
 * the point of sending real bytes over it. */
function deadSocket(): TransportSocket {
  return {
    send: () => undefined,
    close: () => undefined,
    terminate: () => undefined,
    onData: () => undefined,
    onClose: () => undefined,
  };
}

describe('Flusher', () => {
  it('a rejecting drain is caught and logged, never an unhandled rejection (void is not error handling)', async () => {
    const queue = new OutboundQueue(dir);
    // Force drain()'s very first read to throw, simulating any unexpected
    // failure inside the drain loop.
    vi.spyOn(queue, 'list').mockImplementation(() => {
      throw new Error('boom');
    });
    const connections = new ConnectionRegistry();
    const logs: string[] = [];
    const flusher = new Flusher({
      queue,
      connections,
      log: (m) => logs.push(m),
      retryIntervalMs: 10,
    });

    let unhandled: unknown;
    const onUnhandled = (reason: unknown) => {
      unhandled = reason;
    };
    process.once('unhandledRejection', onUnhandled);

    const connection = createConnection({
      peerId: PEER,
      role: 'initiator',
      socket: deadSocket(),
      registry: new StreamRegistry(),
    });
    connections.add(connection);
    flusher.kick(PEER);

    await new Promise((resolve) => setTimeout(resolve, 100));
    process.removeListener('unhandledRejection', onUnhandled);

    expect(unhandled).toBeUndefined();
    expect(logs.some((m) => m.includes('boom'))).toBe(true);
  });

  it('a revoked peer is never drained, even with a live connection and a non-empty queue (D5)', async () => {
    const queue = new OutboundQueue(dir);
    queue.enqueue(REVOKED_PEER, {
      id: 'x',
      from: '00000000000000a0',
      to: REVOKED_PEER,
      seq: 1,
      topic: 't',
      payload: 'x',
      encoding: 'utf8',
      createdAt: Date.now(),
    });
    const connections = new ConnectionRegistry();
    const openedStream = vi.fn();
    const flusher = new Flusher({
      queue,
      connections,
      isRevoked: (peerId) => peerId === REVOKED_PEER,
      retryIntervalMs: 10,
    });

    const connection = createConnection({
      peerId: REVOKED_PEER,
      role: 'initiator',
      socket: {
        ...deadSocket(),
        send: openedStream,
      },
      registry: new StreamRegistry(),
    });
    connections.add(connection);
    flusher.kick(REVOKED_PEER);

    await new Promise((resolve) => setTimeout(resolve, 100));
    // Nothing was ever sent: the drain loop must return before it even
    // tries to open the `msg` stream.
    expect(openedStream).not.toHaveBeenCalled();
    expect(queue.list(REVOKED_PEER)).toHaveLength(1);
  });
});
