/**
 * A dial that cannot finish has to fail rather than hang.
 *
 * The shape of host this is about is not one that refuses — that already
 * fails in milliseconds — but one whose kernel completes the TCP
 * handshake while the process behind it answers nothing: a suspended
 * machine, an app wedged before its HTTP server runs. Both fetches and
 * the WebSocket upgrade then wait on a socket that is open and idle,
 * which undici does for about five minutes and `transport.connect` does
 * forever.
 *
 * It matters more than it reads, because callers share dials: one
 * in-flight dial per peer is what keeps a dropped machine from burning a
 * pane's whole retry budget on races, and it also means one hung dial is
 * every caller's hung dial — the manual Reconnect included, since it
 * joins the same promise instead of starting its own.
 */
import { createServer, type Server, type Socket } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dial, DialTimeoutError, pair } from './client.js';
import { Host } from './host.js';
import { loadOrCreateIdentity } from './identity.js';
import { PeerTable } from './peer-table.js';
import type { Transport, TransportSocket } from './transport.js';

/** Long enough to be unambiguously deliberate, short enough that a test
 * that regressed to "no bound" is caught by the runner rather than by
 * somebody watching CI. */
const BUDGET_MS = 400;

let dirHost: string;
let dirClient: string;
let host: Host;
let blackHole: Server | undefined;
const accepted: Socket[] = [];

beforeEach(() => {
  dirHost = mkdtempSync(join(tmpdir(), 'beam-dial-host-'));
  dirClient = mkdtempSync(join(tmpdir(), 'beam-dial-client-'));
});

afterEach(async () => {
  for (const socket of accepted.splice(0, accepted.length)) socket.destroy();
  await new Promise<void>((done) => {
    if (!blackHole) {
      done();
      return;
    }
    blackHole.close(() => done());
  });
  blackHole = undefined;
  await host?.close();
  rmSync(dirHost, { recursive: true, force: true });
  rmSync(dirClient, { recursive: true, force: true });
});

/** A paired client, and the host it is paired with. The host is real
 * because pairing is: the client has to hold the host's key to dial it
 * at all. */
async function pairedClient(): Promise<{
  baseUrl: string;
  hostPeerId: string;
  identity: ReturnType<typeof loadOrCreateIdentity>;
  peers: PeerTable;
}> {
  const hostIdentity = loadOrCreateIdentity(dirHost, {
    hostname: () => 'workbox',
  });
  host = new Host({
    identity: hostIdentity,
    peers: new PeerTable(dirHost),
    port: 0,
    capabilities: ['streams'],
  });
  await host.listen();
  const identity = loadOrCreateIdentity(dirClient, {
    hostname: () => 'laptop',
  });
  const peers = new PeerTable(dirClient);
  const { url } = host.issuePairingUrl();
  await pair(url, peers, { identity });
  return {
    baseUrl: host.baseUrl,
    hostPeerId: hostIdentity.peerId,
    identity,
    peers,
  };
}

/** Accepts TCP and answers nothing — the far end of the failure. */
function startBlackHole(): Promise<string> {
  return new Promise((resolve) => {
    blackHole = createServer((socket) => {
      socket.on('error', () => undefined);
      accepted.push(socket);
    });
    blackHole.listen(0, '127.0.0.1', () => {
      const address = blackHole?.address();
      const port = typeof address === 'string' ? 0 : address?.port;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

describe('a dial against a host that accepts and never answers', () => {
  it('gives up on its budget instead of waiting out undici', async () => {
    const client = await pairedClient();
    const url = await startBlackHole();

    const startedAt = Date.now();
    await expect(
      dial(url, client.hostPeerId, {
        identity: client.identity,
        peers: client.peers,
        timeoutMs: BUDGET_MS,
      })
    ).rejects.toBeInstanceOf(DialTimeoutError);
    // The point is the bound, not merely that something rejected: a
    // rejection five minutes late is the bug.
    expect(Date.now() - startedAt).toBeLessThan(BUDGET_MS * 5);
    expect(accepted.length).toBeGreaterThan(0); // it really did connect
  });

  it('bounds the upgrade too, and drops a socket that opens too late', async () => {
    // The HTTP half can answer perfectly and the WebSocket upgrade still
    // hang: `Transport.connect` is three methods with no cancellation,
    // so the timeout has to be here and the socket it abandons has to be
    // destroyed — a host otherwise keeps a client nobody holds.
    const client = await pairedClient();
    let finishConnect: (socket: TransportSocket) => void = () => undefined;
    let terminated = 0;
    const stalling: Transport = {
      connect: () =>
        new Promise<TransportSocket>((resolve) => {
          finishConnect = resolve;
        }),
    };

    await expect(
      dial(client.baseUrl, client.hostPeerId, {
        identity: client.identity,
        peers: client.peers,
        transport: stalling,
        timeoutMs: BUDGET_MS,
      })
    ).rejects.toThrow(/dial timed out/);

    finishConnect({
      send: () => undefined,
      close: () => undefined,
      terminate: () => {
        terminated += 1;
      },
      onData: () => undefined,
      onClose: () => undefined,
    });
    await Promise.resolve();
    expect(terminated).toBe(1);
  });

  it('still completes a dial that answers inside the budget', async () => {
    // The control. A budget that rejected everything would pass the two
    // assertions above and break every working connection in the app.
    const client = await pairedClient();
    const connection = await dial(client.baseUrl, client.hostPeerId, {
      identity: client.identity,
      peers: client.peers,
      timeoutMs: 10_000,
    });
    expect(connection.peerId).toBe(client.hostPeerId);
    connection.close();
  });
});
