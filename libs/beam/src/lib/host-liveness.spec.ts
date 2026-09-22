/**
 * The accepting side of liveness, end to end: a paired client that
 * authenticates, opens a real shell, and then stops answering.
 *
 * Both halves of the connection have to probe, and this is the half that
 * costs something when it does not. A host whose client has vanished
 * holds that client's shells open, keeps their processes running, and
 * keeps their slots in the per-peer PTY budget — until the peer comes
 * back and `ConnectionRegistry.add` supersedes the old connection, which
 * for a machine that never comes back is never.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dial, pair } from './client.js';
import type { Transport } from './transport.js';
import { Host } from './host.js';
import { loadOrCreateIdentity } from './identity.js';
import { PeerTable } from './peer-table.js';
import { createPtyStreamHandler } from './pty-handler.js';
import { nonPongingTransport } from '../test-support/hostile-peer.js';
import { WebSocketTransport } from './transport.js';

/** The same bounds the other liveness specs run at. Short enough to keep
 * the suite fast; the timeout is wide enough that a loaded box stalling
 * between a ping and its pong does not fail the control below, and still
 * several times inside the window that control watches. */
const INTERVAL_MS = 400;
const TIMEOUT_MS = 600;
/** Several intervals and several timeouts, for the control. */
const OBSERVATION_MS = 3000;

let dirHost: string;
let dirClient: string;
let host: Host;

beforeEach(() => {
  dirHost = mkdtempSync(join(tmpdir(), 'beam-live-host-'));
  dirClient = mkdtempSync(join(tmpdir(), 'beam-live-client-'));
});

afterEach(async () => {
  await host?.close();
  rmSync(dirHost, { recursive: true, force: true });
  rmSync(dirClient, { recursive: true, force: true });
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function until(
  predicate: () => boolean,
  budgetMs = 5000
): Promise<boolean> {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(10);
  }
  return predicate();
}

function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Stand up a host with a live pty handler and attach a paired client
 * over `transport`, leaving a real shell running on the host. The two
 * tests differ in exactly one thing — whether that client answers a
 * ping — so everything else is shared rather than restated.
 */
async function hostWithAttachedShell(transport: Transport): Promise<{
  clientPeerId: string;
  pid: number;
}> {
  const hostIdentity = loadOrCreateIdentity(dirHost, {
    hostname: () => 'workbox',
  });
  const hostPeers = new PeerTable(dirHost);
  host = new Host({
    identity: hostIdentity,
    peers: hostPeers,
    port: 0,
    capabilities: ['streams', 'pty'],
    liveness: { intervalMs: INTERVAL_MS, timeoutMs: TIMEOUT_MS },
  });
  host.registry.register('pty', createPtyStreamHandler());
  await host.listen();

  const clientIdentity = loadOrCreateIdentity(dirClient, {
    hostname: () => 'laptop',
  });
  const clientPeers = new PeerTable(dirClient);
  const { url } = host.issuePairingUrl();
  await pair(url, clientPeers, { identity: clientIdentity });

  const connection = await dial(host.baseUrl, hostIdentity.peerId, {
    identity: clientIdentity,
    peers: clientPeers,
    // Only the host's monitor is in play in this file: the client's own
    // is off, so whatever happens to this connection is the accepting
    // side's decision.
    transport,
    liveness: false,
  });

  // A real shell on the host, and its pid, straight from the process
  // itself — `exec` makes the pid the shell prints its own.
  const stream = await connection.openStream('pty', {
    argv: ['sh', '-c', 'echo $$; exec sleep 300'],
  });
  let output = '';
  stream.onData((data) => {
    output += Buffer.from(data).toString('utf8');
  });
  expect(await until(() => /\d+/.test(output))).toBe(true);
  const pid = Number(/(\d+)/.exec(output)?.[1]);
  expect(running(pid)).toBe(true);
  expect(host.connections.get(clientIdentity.peerId)).toBeDefined();
  return { clientPeerId: clientIdentity.peerId, pid };
}

describe('a host whose client stops answering', () => {
  it('drops the connection and kills the shell that client left running', async () => {
    const { clientPeerId, pid } = await hostWithAttachedShell(
      nonPongingTransport()
    );

    // Nothing changes on the socket from here: the client is still there,
    // still ESTABLISHED, still sending nothing. Only the unanswered ping
    // separates it from a healthy one.
    expect(
      await until(() => host.connections.get(clientPeerId) === undefined)
    ).toBe(true);
    expect(await until(() => !running(pid))).toBe(true);
  });

  it('keeps a client that answers, and the shell it left running', async () => {
    // The control this file needs of its own. Without it "the host drops
    // a silent client" is indistinguishable from "the host drops
    // clients", and the only thing standing between the assertion above
    // and that reading would be the symmetry of `createConnection` —
    // proved elsewhere, for a different pair of ends.
    const { clientPeerId, pid } = await hostWithAttachedShell(
      new WebSocketTransport()
    );

    await sleep(OBSERVATION_MS);

    expect(host.connections.get(clientPeerId)).toBeDefined();
    expect(running(pid)).toBe(true);
  });
});
