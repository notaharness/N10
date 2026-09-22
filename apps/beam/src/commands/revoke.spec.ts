import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ConnectionRegistry,
  PeerTable,
  StreamRegistry,
  dial,
  loadOrCreateIdentity,
  pair,
} from '@n10/beam';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runRevoke } from './revoke.js';
import { makeFakeIoWithBeamDir, type FakeIo } from '../test-support/fake-io.js';
import { startNode, type NodeHandle } from '../node.js';

let io: FakeIo;
let beamDir: string;
let peerDir: string;
let a: NodeHandle;

beforeEach(async () => {
  ({ io, beamDir } = makeFakeIoWithBeamDir());
  peerDir = mkdtempSync(join(tmpdir(), 'beam-revoke-peer-'));
  a = await startNode(io, { hostname: '127.0.0.1', port: 0 });
});

afterEach(async () => {
  await a.close();
  rmSync(beamDir, { recursive: true, force: true });
  rmSync(peerDir, { recursive: true, force: true });
});

describe('beam revoke', () => {
  it('through a running node takes effect immediately, without a restart, and drops the live connection', async () => {
    // A separate machine dials in to a — a real live connection on a's
    // side, entirely at the library level (the CLI under test only ever
    // sees a, the node being revoked from).
    const peerIdentity = loadOrCreateIdentity(peerDir, {
      hostname: () => 'workbox',
    });
    const peerPeers = new PeerTable(peerDir);
    await pair(a.host.issuePairingUrl().url, peerPeers, {
      identity: peerIdentity,
    });
    const connection = await dial(a.host.baseUrl, a.identity.peerId, {
      identity: peerIdentity,
      peers: peerPeers,
      registry: new StreamRegistry(),
      connections: new ConnectionRegistry(),
    });

    expect(a.peers.get(peerIdentity.peerId)?.revoked).toBe(false);
    expect(a.connections.get(peerIdentity.peerId)).toBeDefined();

    const code = await runRevoke(['workbox'], io);
    expect(code).toBe(0);
    expect(io.stdoutText()).toContain('revoked "workbox"');

    // Applied to a's own live PeerTable — the same process, no restart —
    // and the live connection that peer held is gone.
    expect(a.peers.get(peerIdentity.peerId)?.revoked).toBe(true);
    expect(a.connections.get(peerIdentity.peerId)).toBeUndefined();
    // Persisted too, so a process that does restart still sees it.
    expect(new PeerTable(a.beamDir).get(peerIdentity.peerId)?.revoked).toBe(
      true
    );

    connection.close();
  });

  it('falls back to a direct file write when no node is running', async () => {
    await a.close();
    const peers = new PeerTable(beamDir);
    peers.upsert({
      peerId: 'aaaaaaaaaaaaaaaa',
      label: 'offline-peer',
      publicKeyPem: 'key-a',
      endpoints: [],
    });

    const code = await runRevoke(['offline-peer'], io);
    expect(code).toBe(0);
    expect(new PeerTable(beamDir).get('aaaaaaaaaaaaaaaa')?.revoked).toBe(true);

    // Restart a fresh node so afterEach's close() has something to close.
    a = await startNode(io, { hostname: '127.0.0.1', port: 0 });
  });
});
