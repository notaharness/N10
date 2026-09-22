/**
 * A healthy peer behind a link that cannot keep up — the failure neither
 * `hostile-peer.ts` nor any fake can express.
 *
 * beam has no flow control (docs/beam.md leaves it explicitly out of
 * scope), and a WebSocket pong is an ordinary frame: `ws` writes it
 * straight to the socket, in order, behind whatever is already queued
 * there. So a peer whose output outruns the link answers every ping
 * correctly and still answers late, by however long its own backlog
 * takes to drain. A remote pane emitting faster than the link carries is
 * exactly that, and it is indistinguishable from a machine that has gone
 * away to anything watching only for pongs.
 *
 * Reproducing it needs a real send buffer and a real reader that is not
 * draining it: `startFirehosePeer` supplies the first, `dialThrottled`
 * the second. Both halves have to be real — the delay is a property of
 * the kernel's receive window and `ws`'s write queue, and a cooperative
 * peer asked to "answer slowly" would only prove that a test can make a
 * peer answer slowly.
 */

import { once } from 'node:events';
import WebSocketClient from 'ws';
import type { WebSocket } from 'ws';
import { WebSocketServer } from 'ws';
import {
  encodeFrame,
  FrameType,
  MAX_TRANSPORT_MESSAGE_BYTES,
} from '../lib/protocol.js';
import { wrapWebSocket, type TransportSocket } from '../lib/transport.js';

/** The stream the firehose peer opens. An acceptor allocates even ids
 * (`stream-ids.ts`), so 2 is the first one it may use, and the dialing
 * side under test only has to register a handler for this name. */
export const FIREHOSE_STREAM = 'firehose';
const FIREHOSE_STREAM_ID = 2;
/** Big enough that a throttled reader falls behind quickly, well under
 * `MAX_PAYLOAD`. */
const FIREHOSE_CHUNK_BYTES = 64 * 1024;
/** Stop feeding `ws` once this much is already queued. The point is a
 * backlog on the wire, not an unbounded one in this process's heap. */
const FIREHOSE_QUEUE_LIMIT_BYTES = 24 * 1024 * 1024;

export interface FirehosePeer {
  url: string;
  /** How many bytes `ws` has accepted but not yet handed to the kernel —
   * the backlog the pong has to queue behind. */
  queuedBytes(): number;
  /** Stop writing, without closing anything. The socket stays
   * ESTABLISHED and the peer stays silent — what a machine that goes
   * away mid-stream looks like from this side. */
  silence(): void;
  close(): Promise<void>;
}

export interface FirehoseOptions {
  /** Answer pings. `false` isolates the inbound-frame path: nothing but
   * the peer's own data can be keeping the connection alive. */
  autoPong?: boolean;
}

/**
 * A healthy peer that talks a lot: it opens a real beam stream and writes
 * valid `Data` frames as fast as the socket will take them, and answers
 * pings normally. Paired with `dialThrottled` it reproduces the one
 * failure a cooperative fake cannot — a pong stuck behind a send buffer a
 * slow reader is not draining, on a connection that is in every other
 * respect working.
 *
 * The frames are real ones (`encodeFrame`), not filler: the muxer on the
 * far side closes a connection whose bytes it cannot decode, so garbage
 * would end the test for the wrong reason.
 */
export function startFirehosePeer(
  options: FirehoseOptions = {}
): Promise<FirehosePeer> {
  const server = new WebSocketServer({
    port: 0,
    autoPong: options.autoPong ?? true,
  });
  const sockets: WebSocket[] = [];
  const chunk = new Uint8Array(FIREHOSE_CHUNK_BYTES).fill(0x61);
  let silenced = false;
  server.on('connection', (socket) => {
    socket.on('error', () => undefined);
    sockets.push(socket);
    let seq = 0;
    socket.send(
      encodeFrame({
        type: FrameType.Open,
        streamId: FIREHOSE_STREAM_ID,
        seq: seq++,
        payload: new TextEncoder().encode(
          JSON.stringify({ name: FIREHOSE_STREAM })
        ),
      })
    );
    const pump = (): void => {
      if (silenced || socket.readyState !== socket.OPEN) return;
      while (
        socket.bufferedAmount < FIREHOSE_QUEUE_LIMIT_BYTES &&
        socket.readyState === socket.OPEN
      ) {
        socket.send(
          encodeFrame({
            type: FrameType.Data,
            streamId: FIREHOSE_STREAM_ID,
            seq: seq++,
            payload: chunk,
          })
        );
      }
      // setImmediate, not a tight loop: the peer has to stay responsive
      // enough to answer a ping, or the test would be about a wedged
      // peer rather than a wedged link.
      setImmediate(pump);
    };
    pump();
  });
  return new Promise((resolve) => {
    server.on('listening', () => {
      const address = server.address();
      const port = typeof address === 'string' ? 0 : address?.port;
      resolve({
        url: `ws://127.0.0.1:${port}`,
        queuedBytes: () =>
          sockets.reduce((total, socket) => total + socket.bufferedAmount, 0),
        silence: () => {
          silenced = true;
        },
        close: () =>
          new Promise((done) => {
            for (const socket of sockets) socket.terminate();
            server.close(() => done());
          }),
      });
    });
  });
}

export interface ThrottledDial {
  socket: TransportSocket;
  /** Read at full speed again, and stop metering. */
  release(): void;
}

/** How often the reader's byte budget is refilled. Small enough that the
 * link reads as steady rather than as a burst every tick. */
const METER_TICK_MS = 100;

/**
 * Dial `url` behind a reader that consumes at most `bytesPerSecond` — a
 * token bucket over `ws`'s own `pause()`/`resume()`, so the throttling
 * happens where a slow link's does: the receive window closes, the
 * peer's writes back up in its send buffer, and everything it writes
 * after that point waits its turn behind them. A pong included.
 *
 * Metered in bytes rather than in milliseconds on purpose. A duty cycle
 * of "read for 20ms in every 220ms" is not a rate: on loopback a 20ms
 * window drains tens of megabytes, and the test would measure the host's
 * memory bandwidth instead of the behaviour under test.
 */
export async function dialThrottled(
  url: string,
  options: { bytesPerSecond: number }
): Promise<ThrottledDial> {
  const socket = new WebSocketClient(url, {
    maxPayload: MAX_TRANSPORT_MESSAGE_BYTES,
  });
  socket.binaryType = 'nodebuffer';
  socket.on('error', () => undefined);
  // Wrapped before the handshake completes, not after: this peer sends
  // the instant it accepts, and `EventEmitter` drops what arrives before
  // a listener exists. `wrapWebSocket` attaches its own immediately and
  // buffers until a consumer asks — the same reason it does so in
  // production (`transport.ts`).
  const wrapped = wrapWebSocket(socket);
  const perTick = Math.max(
    1,
    Math.round((options.bytesPerSecond * METER_TICK_MS) / 1000)
  );
  let budget = perTick;
  let released = false;
  socket.on('message', (data) => {
    budget -= (data as Buffer).byteLength;
    if (budget <= 0 && !released) socket.pause();
  });
  await once(socket, 'open');
  const meter = setInterval(() => {
    budget = perTick;
    if (!released) socket.resume();
  }, METER_TICK_MS);
  meter.unref?.();
  return {
    socket: wrapped,
    release: () => {
      released = true;
      clearInterval(meter);
      socket.resume();
    },
  };
}
