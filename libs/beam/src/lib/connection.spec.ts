import { describe, expect, it } from 'vitest';
import { createConnection } from './connection.js';
import { encodeFrame, FrameType } from './protocol.js';
import { StreamRegistry } from './stream-registry.js';
import type { TransportSocket } from './transport.js';

/** In-memory TransportSocket pair, connected directly. */
function wireSockets(): [TransportSocket, TransportSocket] {
  const aHandlers: ((data: Uint8Array) => void)[] = [];
  const bHandlers: ((data: Uint8Array) => void)[] = [];
  const aCloseHandlers: (() => void)[] = [];
  const bCloseHandlers: (() => void)[] = [];
  const a: TransportSocket = {
    send: (data) => bHandlers.forEach((h) => h(data)),
    close: () => aCloseHandlers.forEach((h) => h()),
    terminate: () => aCloseHandlers.forEach((h) => h()),
    onData: (h) => aHandlers.push(h),
    onClose: (h) => aCloseHandlers.push(h),
  };
  const b: TransportSocket = {
    send: (data) => aHandlers.forEach((h) => h(data)),
    close: () => bCloseHandlers.forEach((h) => h()),
    terminate: () => bCloseHandlers.forEach((h) => h()),
    onData: (h) => bHandlers.push(h),
    onClose: (h) => bCloseHandlers.push(h),
  };
  return [a, b];
}

describe('createConnection', () => {
  it('carries the given peerId', () => {
    const [socket] = wireSockets();
    const conn = createConnection({
      peerId: 'peer-x',
      role: 'initiator',
      socket,
      registry: new StreamRegistry(),
    });
    expect(conn.peerId).toBe('peer-x');
  });

  it('onStream registers into the shared registry so the peer can open that stream', async () => {
    const [a, b] = wireSockets();
    const registryA = new StreamRegistry();
    const registryB = new StreamRegistry();
    const connA = createConnection({
      peerId: 'b',
      role: 'initiator',
      socket: a,
      registry: registryA,
    });
    createConnection({
      peerId: 'a',
      role: 'acceptor',
      socket: b,
      registry: registryB,
    });

    let received: Uint8Array | undefined;
    registryB.register('greet', (stream) => {
      stream.control({ kind: 'opened' });
      stream.onData((data) => {
        received = data;
      });
    });

    const stream = await connA.openStream('greet');
    stream.write(new TextEncoder().encode('hi'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(received && new TextDecoder().decode(received)).toBe('hi');
  });

  it('close() notifies onClose exactly once', () => {
    const [a] = wireSockets();
    const conn = createConnection({
      peerId: 'p',
      role: 'initiator',
      socket: a,
      registry: new StreamRegistry(),
    });
    let calls = 0;
    conn.onClose(() => {
      calls += 1;
    });
    conn.close();
    conn.close();
    expect(calls).toBe(1);
  });

  it('a transport-level close notifies onClose without an explicit close() call', () => {
    const [a] = wireSockets();
    const conn = createConnection({
      peerId: 'p',
      role: 'initiator',
      socket: a,
      registry: new StreamRegistry(),
    });
    let closed = false;
    conn.onClose(() => {
      closed = true;
    });
    a.close();
    expect(closed).toBe(true);
  });

  it('A7: a transport that ends mid-frame is reported as truncated, not an ordinary close', () => {
    const dataHandlers: ((data: Uint8Array) => void)[] = [];
    const closeHandlers: (() => void)[] = [];
    const socket: TransportSocket = {
      send: () => undefined,
      close: () => closeHandlers.forEach((h) => h()),
      terminate: () => closeHandlers.forEach((h) => h()),
      onData: (h) => dataHandlers.push(h),
      onClose: (h) => closeHandlers.push(h),
    };
    const conn = createConnection({
      peerId: 'p',
      role: 'initiator',
      socket,
      registry: new StreamRegistry(),
    });
    let reason: string | undefined;
    conn.onClose((r) => {
      reason = r;
    });
    // A 12-byte header declaring a 50-byte payload, then nothing: the
    // decoder is left mid-frame when the transport ends right after.
    dataHandlers.forEach((h) =>
      h(new Uint8Array([1, 1, 0, 5, 0, 0, 0, 1, 0, 0, 0, 50, 9, 9]))
    );
    closeHandlers.forEach((h) => h());
    expect(reason).toMatch(/buffered bytes/);
  });

  it('terminate() asks the transport to drop now, and nothing opens after it even if the transport lingers', () => {
    const dataHandlers: ((data: Uint8Array) => void)[] = [];
    const closeHandlers: (() => void)[] = [];
    const calls: string[] = [];
    // The worst case this has to survive: a transport whose close *and*
    // terminate both linger, so bytes keep arriving after the connection is
    // finished with. Real `ws` destroys the socket on terminate; the muxer
    // guards are what make that a belt-and-braces rather than the only lock.
    const socket: TransportSocket = {
      send: () => undefined,
      close: () => calls.push('close'),
      terminate: () => calls.push('terminate'),
      onData: (h) => dataHandlers.push(h),
      onClose: (h) => closeHandlers.push(h),
    };
    const registry = new StreamRegistry();
    const opened: string[] = [];
    registry.register('shell', (stream) => {
      opened.push(stream.name);
      stream.control({ kind: 'opened' });
    });
    const conn = createConnection({
      peerId: 'p',
      role: 'acceptor',
      socket,
      registry,
    });
    const reasons: string[] = [];
    conn.onClose((r) => reasons.push(r));

    const open = encodeFrame({
      type: FrameType.Open,
      streamId: 1,
      seq: 0,
      payload: new TextEncoder().encode('shell'),
    });
    dataHandlers.forEach((h) => h(open));
    expect(opened).toEqual(['shell']);

    conn.terminate('peer revoked');
    expect(calls).toEqual(['terminate']);
    expect(reasons).toEqual(['peer revoked']);

    // The revoked peer keeps sending. It gets nothing: no second shell, and
    // no state added behind the reaping pass `dispose` has already run —
    // which is why the transport's own close arriving later, and `finish`
    // returning early because it already ran, leaves nothing unreaped.
    dataHandlers.forEach((h) =>
      h(
        encodeFrame({
          type: FrameType.Open,
          streamId: 3,
          seq: 0,
          payload: new TextEncoder().encode('shell'),
        })
      )
    );
    closeHandlers.forEach((h) => h());
    expect(opened).toEqual(['shell']);
    expect(reasons).toEqual(['peer revoked']);
  });

  it('an ordinary close (nothing buffered) is not reported as truncated', () => {
    const [a] = wireSockets();
    const conn = createConnection({
      peerId: 'p',
      role: 'initiator',
      socket: a,
      registry: new StreamRegistry(),
    });
    let reason: string | undefined;
    conn.onClose((r) => {
      reason = r;
    });
    a.close();
    expect(reason).not.toMatch(/buffered bytes/);
  });
});
