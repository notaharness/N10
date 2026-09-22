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
import { Host } from './host.js';
import { loadOrCreateIdentity } from './identity.js';
import { PeerTable } from './peer-table.js';
import { createPtyStreamHandler } from './pty-handler.js';
import { nonPongingTransport } from '../test-support/hostile-peer.js';

const INTERVAL_MS = 100;
const TIMEOUT_MS = 150;

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

describe('a host whose client stops answering', () => {
  it('drops the connection and kills the shell that client left running', async () => {
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
      // The client under test is the one that goes quiet, so only the
      // host's monitor is in play here.
      transport: nonPongingTransport(),
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

    // Nothing changes on the socket from here: the client is still there,
    // still ESTABLISHED, still sending nothing. Only the unanswered ping
    // separates it from a healthy one.
    expect(
      await until(
        () => host.connections.get(clientIdentity.peerId) === undefined
      )
    ).toBe(true);
    expect(await until(() => !running(pid))).toBe(true);
  });
});
