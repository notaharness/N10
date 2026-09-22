/**
 * The reproduction the audit ran, as a test: a peer process frozen
 * mid-stream with SIGSTOP. Its kernel keeps the socket ESTABLISHED and
 * keeps ACKing, so nothing about the connection changes — before this
 * mechanism existed the peer read as connected until the process was
 * actually killed.
 *
 * A second process is the point. An in-process peer can be made to skip
 * its pongs (`hostile-peer.ts`'s `startSilentPeer`, which carries most of
 * the assertions), but it cannot have its event loop stopped, and the
 * question this file answers is whether the two are really the same thing
 * on the wire.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createConnection, type PeerConnection } from './connection.js';
import { StreamRegistry } from './stream-registry.js';
import { WebSocketTransport } from './transport.js';
import {
  spawnFreezablePeer,
  type FreezablePeer,
} from '../test-support/hostile-peer.js';

const INTERVAL_MS = 200;
const TIMEOUT_MS = 600;
/** Well inside the pong timeout: the point is that a peer frozen for less
 * than the bound is not dropped. */
const BRIEF_FREEZE_MS = 150;
/** Watched for longer than a timeout after the thaw, so a monitor that
 * stopped hearing pongs would be seen dropping the peer. */
const OBSERVATION_MS = 1400;

let peer: FreezablePeer;
let connection: PeerConnection;

afterEach(() => {
  connection?.close();
  peer?.kill();
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function until(
  predicate: () => boolean,
  budgetMs = 4000
): Promise<boolean> {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(10);
  }
  return predicate();
}

/** Dial the peer and prove the connection is carrying traffic before
 * anything is frozen: "mid-stream" has to be true for the test to be
 * about a connection that was working. */
async function connectAndEcho(url: string): Promise<{
  connection: PeerConnection;
  closes: string[];
  echo: () => Promise<boolean>;
}> {
  const socket = await new WebSocketTransport().connect(url);
  const closes: string[] = [];
  const echoes: Uint8Array[] = [];
  socket.onData((data) => echoes.push(data));
  const created = createConnection({
    peerId: 'frozen-peer',
    role: 'initiator',
    socket,
    registry: new StreamRegistry(),
    liveness: { intervalMs: INTERVAL_MS, timeoutMs: TIMEOUT_MS },
  });
  created.onClose((reason) => closes.push(reason));
  return {
    connection: created,
    closes,
    echo: async () => {
      const before = echoes.length;
      // Any frame will do: the peer echoes bytes without interpreting
      // them, and the muxer drops what it cannot decode.
      socket.send(new Uint8Array([1, 2, 3, 4]));
      return until(() => echoes.length > before, 1000);
    },
  };
}

describe('a peer process frozen mid-stream', () => {
  it('is dropped, where before it stayed connected until the process died', async () => {
    peer = await spawnFreezablePeer();
    const dialed = await connectAndEcho(peer.url);
    connection = dialed.connection;
    expect(await dialed.echo()).toBe(true);

    peer.freeze();

    expect(await until(() => dialed.closes.length > 0)).toBe(true);
    expect(dialed.closes[0]).toMatch(/no pong within 600ms/);
    expect(await connection.checkAlive(TIMEOUT_MS)).toBe(false);
  });

  it('survives a freeze shorter than the bound, and still carries traffic after it', async () => {
    // The other half of the contract, and the one a too-eager timer
    // breaks: a machine that stalls briefly — a long GC, a loaded CI
    // box, a laptop catching up after a lid — is not a machine that has
    // gone away.
    peer = await spawnFreezablePeer();
    const dialed = await connectAndEcho(peer.url);
    connection = dialed.connection;
    expect(await dialed.echo()).toBe(true);

    peer.freeze();
    await sleep(BRIEF_FREEZE_MS);
    peer.thaw();

    await sleep(OBSERVATION_MS);
    expect(dialed.closes).toEqual([]);
    expect(await dialed.echo()).toBe(true);
    expect(await connection.checkAlive(TIMEOUT_MS)).toBe(true);
  });
});
