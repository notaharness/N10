/**
 * A healthy peer on a link that cannot keep up.
 *
 * beam has no flow control, and a pong is an ordinary WebSocket frame
 * written in order behind everything already on the socket. A peer whose
 * output outruns the link therefore answers every ping and still answers
 * late — the pong is queued behind megabytes of stream data — while the
 * far process, its event loop and its application are all fine. Dropping
 * it is worse than the failure the monitor exists for: a real machine,
 * with real work in flight on it, reaped because the link was busy.
 *
 * Nothing cooperative reproduces this. The peer here is not pretending to
 * be slow: it is a real `ws` server with `autoPong` on, writing real
 * frames into a real send buffer that the reader under test is not
 * draining (`src/test-support/slow-link.ts`). The delay comes from the
 * kernel's receive window, which is the only thing that makes the
 * assertions mean anything.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createConnection, type PeerConnection } from './connection.js';
import { StreamRegistry } from './stream-registry.js';
import {
  dialThrottled,
  startFirehosePeer,
  FIREHOSE_STREAM,
  type FirehosePeer,
  type ThrottledDial,
} from '../test-support/slow-link.js';

/** Fast enough to keep the suite short. The pong bound is what the
 * backlog has to beat, so it is the number the test is really about. */
const INTERVAL_MS = 200;
const TIMEOUT_MS = 1000;
/** ~2 Mbit/s: slower than a peer writing 64 KiB frames as fast as `ws`
 * accepts them, by orders of magnitude, which is the whole point. Slow
 * enough that the backlog ahead of a pong takes longer than the pong
 * bound to drain; fast enough that the stream still visibly arrives. */
const LINK_BYTES_PER_SECOND = 256 * 1024;
/** Several ping intervals and several pong timeouts. */
const OBSERVATION_MS = 5000;
/** Room for the observation window plus the drop that follows it. */
const TEST_TIMEOUT_MS = 30_000;

let peer: FirehosePeer;
let dialed: ThrottledDial;
let connection: PeerConnection;

afterEach(async () => {
  dialed?.release();
  connection?.terminate('test over');
  await peer?.close();
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('a healthy peer whose pongs are stuck behind its own output', () => {
  it(
    'is kept alive by the frames that arrive instead',
    async () => {
      peer = await startFirehosePeer();
      dialed = await dialThrottled(peer.url, {
        bytesPerSecond: LINK_BYTES_PER_SECOND,
      });

      // Every pong this connection hears, and when. A gap longer than the
      // monitor's own bound is the thing being reproduced — without one,
      // the rest of the test would pass on a link that was never slow.
      const pongsAt: number[] = [];
      dialed.socket.onPong?.(() => pongsAt.push(Date.now()));

      const registry = new StreamRegistry();
      let received = 0;
      registry.register(FIREHOSE_STREAM, (stream) => {
        stream.onData((data) => {
          received += data.byteLength;
        });
      });
      const closes: string[] = [];
      connection = createConnection({
        peerId: 'busy-peer',
        role: 'initiator',
        socket: dialed.socket,
        registry,
        liveness: { intervalMs: INTERVAL_MS, timeoutMs: TIMEOUT_MS },
      });
      connection.onClose((reason) => closes.push(reason));

      // Sampled while the connection is up rather than read at the end: a
      // dropped connection takes the peer's socket with it, and a setup
      // assertion that collapses when the behaviour under test fails
      // reports the wrong thing.
      const startedAt = Date.now();
      let peakQueued = 0;
      while (Date.now() - startedAt < OBSERVATION_MS) {
        peakQueued = Math.max(peakQueued, peer.queuedBytes());
        await sleep(100);
      }

      // The link really is backed up: the peer has frames it has handed to
      // `ws` and `ws` has not been able to put on the wire.
      expect(peakQueued).toBeGreaterThan(1_000_000);
      // And the peer really is talking to us the whole time.
      expect(received).toBeGreaterThan(0);

      // The pong the monitor asked for did not come back inside its bound,
      // at least once — this is the reviewer's measurement, as a guard.
      const marks = [startedAt, ...pongsAt, Date.now()];
      const longestSilence = marks
        .slice(1)
        .reduce(
          (worst, at, index) => Math.max(worst, at - (marks[index] as number)),
          0
        );
      expect(longestSilence).toBeGreaterThan(TIMEOUT_MS);

      // And the connection survived it. A monitor that only counted pongs
      // would have terminated a machine with live work on it.
      expect(closes).toEqual([]);

      // Including the one-shot question the desktop's reconnect path asks
      // before it decides to redial: frames arriving answer it too.
      expect(await connection.checkAlive(TIMEOUT_MS)).toBe(true);
    },
    TEST_TIMEOUT_MS
  );

  it(
    'is kept alive by its frames alone, and dropped the moment they stop',
    async () => {
      // Inbound data as evidence, isolated: this peer never answers a ping
      // at all, so the only thing standing between it and the monitor is
      // the stream it is writing. Watched for several intervals and
      // several timeouts — a monitor that counted only pongs would have
      // dropped it in the first `INTERVAL_MS + TIMEOUT_MS`.
      peer = await startFirehosePeer({ autoPong: false });
      dialed = await dialThrottled(peer.url, {
        bytesPerSecond: LINK_BYTES_PER_SECOND,
      });
      const registry = new StreamRegistry();
      registry.register(FIREHOSE_STREAM, (stream) => {
        stream.onData(() => undefined);
      });
      const closes: string[] = [];
      connection = createConnection({
        peerId: 'busy-peer',
        role: 'initiator',
        socket: dialed.socket,
        registry,
        liveness: { intervalMs: INTERVAL_MS, timeoutMs: TIMEOUT_MS },
      });
      connection.onClose((reason) => closes.push(reason));

      await sleep(OBSERVATION_MS);
      expect(closes).toEqual([]);

      // Now the peer goes away mid-stream: it stops writing and stops
      // answering, but closes nothing, so the socket stays ESTABLISHED and
      // only the monitor can notice. Reading at full speed from here, so
      // the queued backlog drains rather than trickling in and standing in
      // for a peer that is no longer there.
      peer.silence();
      dialed.release();

      const deadline = Date.now() + 6000;
      while (closes.length === 0 && Date.now() < deadline) await sleep(20);
      expect(closes[0]).toMatch(/no pong within 1000ms/);
    },
    TEST_TIMEOUT_MS
  );
});
