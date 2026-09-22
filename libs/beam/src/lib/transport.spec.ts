import { WebSocketServer } from 'ws';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocketTransport } from './transport.js';

let server: WebSocketServer;
let url: string;

beforeEach(async () => {
  server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  url = `ws://127.0.0.1:${port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('WebSocketTransport', () => {
  it('connects and exchanges binary frames in both directions', async () => {
    server.on('connection', (ws) => {
      ws.on('message', (data, isBinary) => {
        if (isBinary) ws.send(data);
      });
    });

    const transport = new WebSocketTransport();
    const socket = await transport.connect(url);
    const echoed = new Promise<Uint8Array>((resolve) => socket.onData(resolve));
    socket.send(new Uint8Array([1, 2, 3]));
    expect(Array.from(await echoed)).toEqual([1, 2, 3]);
    socket.close();
  });

  it('notifies onClose when the server ends the connection', async () => {
    server.on('connection', (ws) => ws.close());

    const transport = new WebSocketTransport();
    const socket = await transport.connect(url);
    let closed = false;
    socket.onClose(() => {
      closed = true;
    });
    await new Promise<void>((resolve) => socket.onClose(resolve));
    expect(closed).toBe(true);
  });

  it('rejects connect() when nothing is listening at the target port', async () => {
    const transport = new WebSocketTransport();
    await expect(transport.connect('ws://127.0.0.1:1')).rejects.toThrow();
  });

  it('does not lose a frame the peer sends the instant the connection completes, before onData is wired', async () => {
    // Regression: dial() does `await transport.connect(url)` before wiring
    // a Muxer to the result. A peer that sends data as soon as *it* sees
    // the connection accepted — exactly what the mailbox flusher does when
    // mail is already queued for a reconnecting peer — can win that race,
    // and the frame must not be dropped in the gap.
    server.on('connection', (ws) => {
      ws.send(new Uint8Array([9, 8, 7]));
    });

    const transport = new WebSocketTransport();
    const socket = await transport.connect(url);
    // Deliberately wait a tick *before* wiring onData, widening the exact
    // gap that lost the frame prior to the fix.
    await new Promise((resolve) => setTimeout(resolve, 20));
    const received = await new Promise<Uint8Array>((resolve) =>
      socket.onData(resolve)
    );
    expect(Array.from(received)).toEqual([9, 8, 7]);
    socket.close();
  });
});
