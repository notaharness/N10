/**
 * Liveness against peers that are present and not answering — a real
 * WebSocket on a real socket in every case (see
 * `src/test-support/hostile-peer.ts` for why a fake would prove nothing).
 *
 * Every assertion here has a control beside it: a peer that *does* answer
 * must survive exactly the same timers, or "drops a silent peer" is
 * indistinguishable from "drops everything".
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createConnection } from './connection.js';
import { StreamRegistry } from './stream-registry.js';
import { WebSocketTransport, type TransportSocket } from './transport.js';
import {
  startAnsweringPeer,
  startDeafPeer,
  startSilentPeer,
  type HostilePeer,
} from '../test-support/hostile-peer.js';

/** Short enough to keep the suite fast; the timeout is long enough that a
 * loaded box stalling between a ping and its pong does not fail the "a
 * healthy peer survives" controls, and still well inside the window those
 * controls watch, so a monitor that ignored pongs would trip inside it. */
const INTERVAL_MS = 200;
const TIMEOUT_MS = 400;
/** Several intervals, and several timeouts. */
const OBSERVATION_MS = 2000;

let peer: HostilePeer;

afterEach(async () => {
  await peer?.close();
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function until(
  predicate: () => boolean,
  budgetMs = 3000
): Promise<boolean> {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(10);
  }
  return predicate();
}

async function connectTo(url: string) {
  const socket = await new WebSocketTransport().connect(url);
  const closes: string[] = [];
  const connection = createConnection({
    peerId: 'peer-under-test',
    role: 'initiator',
    socket,
    registry: new StreamRegistry(),
    liveness: { intervalMs: INTERVAL_MS, timeoutMs: TIMEOUT_MS },
  });
  connection.onClose((reason) => closes.push(reason));
  return { connection, closes, socket };
}

/** Keep real bytes moving out over the socket until the returned
 * function is called. The peer records what reaches it, so "the
 * connection is carrying data" is an observation rather than a claim. */
function keepWriting(socket: TransportSocket): () => void {
  const timer = setInterval(() => {
    try {
      socket.send(new Uint8Array([1, 2, 3, 4]));
    } catch {
      // The transport is gone; the test is about to say so.
    }
  }, 50);
  timer.unref?.();
  return () => clearInterval(timer);
}

describe('connection liveness', () => {
  it('drops a peer that accepts and never answers a ping', async () => {
    peer = await startSilentPeer();
    const { connection, closes, socket } = await connectTo(peer.url);
    const accepted = await peer.accepted();
    const peerSideCloseCodes: number[] = [];
    accepted.on('close', (code) => peerSideCloseCodes.push(code));
    const stopWriting = keepWriting(socket);

    // The socket is open and carrying real traffic, and the peer's own
    // side of it is receiving that traffic: nothing distinguishes this
    // peer from a healthy one except that nothing ever comes back —
    // neither a pong nor a frame of its own.
    expect(accepted.readyState).toBe(accepted.OPEN);
    expect(await until(() => peer.received.length > 0)).toBe(true);

    expect(await until(() => closes.length > 0)).toBe(true);
    stopWriting();
    expect(closes[0]).toMatch(/no pong within 400ms/);
    expect(await connection.checkAlive(50)).toBe(false);

    // Dropped, not asked to leave. A graceful close would reach the peer
    // as a close frame (1000) and leave `ws` waiting out its 30s close
    // timeout for an answer this peer has already shown it will not
    // send; a destroyed transport reads as an abnormal closure.
    expect(await until(() => peerSideCloseCodes.length > 0)).toBe(true);
    expect(peerSideCloseCodes[0]).toBe(1006);
  });

  it('keeps a peer that answers, across many intervals', async () => {
    peer = await startAnsweringPeer();
    const { connection, closes } = await connectTo(peer.url);

    await sleep(OBSERVATION_MS);

    expect(closes).toEqual([]);
    expect(await connection.checkAlive(TIMEOUT_MS)).toBe(true);
    connection.close();
  });

  it('keeps a peer whose application has stopped reading but whose transport answers', async () => {
    // The boundary this mechanism does not cross, pinned so nobody reads
    // more into it later: `ws` answers a ping without waking application
    // code, so an application that has wedged still looks alive down
    // here. Catching that is the mailbox ack timeout's job, one layer up.
    peer = await startDeafPeer();
    const { connection, closes } = await connectTo(peer.url);
    let opened = false;
    // Deliberately not awaited: this open is never acknowledged, and
    // waiting out the muxer's own 10s open timeout would say nothing
    // about liveness.
    void connection.openStream('wedged').then(
      () => {
        opened = true;
      },
      () => undefined
    );

    await sleep(OBSERVATION_MS);

    expect(peer.received.length).toBeGreaterThan(0); // the frames arrived
    expect(opened).toBe(false); // and nothing over there answered them
    expect(closes).toEqual([]);
    connection.close();
  });

  it('checkAlive answers false once the connection is closed', async () => {
    peer = await startAnsweringPeer();
    const { connection } = await connectTo(peer.url);
    expect(await connection.checkAlive(TIMEOUT_MS)).toBe(true);

    connection.close();

    expect(await connection.checkAlive(TIMEOUT_MS)).toBe(false);
  });
});
