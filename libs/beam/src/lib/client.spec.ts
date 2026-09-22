import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthError } from './auth.js';
import { ConnectionRegistry } from './connection-registry.js';
import { dial, pair, PeerKeyMismatchError } from './client.js';
import { Host } from './host.js';
import { derivePeerId, loadOrCreateIdentity } from './identity.js';
import { PeerTable } from './peer-table.js';

let hostDir: string;
let clientDir: string;
let host: Host;

beforeEach(async () => {
  hostDir = mkdtempSync(join(tmpdir(), 'beam-host-'));
  clientDir = mkdtempSync(join(tmpdir(), 'beam-client-'));
  const identity = loadOrCreateIdentity(hostDir, { hostname: () => 'workbox' });
  host = new Host({ identity, peers: new PeerTable(hostDir), port: 0 });
  await host.listen();
});

afterEach(async () => {
  await host.close();
  rmSync(hostDir, { recursive: true, force: true });
  rmSync(clientDir, { recursive: true, force: true });
});

describe('pair()', () => {
  it('leaves both sides holding the other identity, with ids each side computed agreeing', async () => {
    const clientIdentity = loadOrCreateIdentity(clientDir, {
      hostname: () => 'laptop',
    });
    const clientPeers = new PeerTable(clientDir);
    const { token, url } = host.issuePairingUrl();
    void token;

    const result = await pair(url, clientPeers, { identity: clientIdentity });

    // The id must be derived from the key the host actually returned, not
    // merely equal to what the client already expected (A3): this is the
    // assertion that fails if the client stores an asserted id unchecked.
    expect(result.peer.peerId).toBe(derivePeerId(result.peer.publicKeyPem));
    expect(result.peer.peerId).toBe(host.identity.peerId);
    expect(clientPeers.get(host.identity.peerId)?.publicKeyPem).toBe(
      host.identity.publicKeyPem
    );

    const storedOnHost = host.peers.get(clientIdentity.peerId);
    expect(storedOnHost?.publicKeyPem).toBe(clientIdentity.publicKeyPem);
    expect(storedOnHost?.label).toBe('laptop');
  });

  it('a spent pairing token cannot be used a second time', async () => {
    const clientPeers = new PeerTable(clientDir);
    const { url } = host.issuePairingUrl();
    const identityA = loadOrCreateIdentity(clientDir, {
      hostname: () => 'laptop',
    });
    await pair(url, clientPeers, { identity: identityA });
    await expect(
      pair(url, clientPeers, { identity: identityA })
    ).rejects.toThrow(/pairing failed/);
  });

  it('refuses to replace an existing peer stored under the same id with a different key, unless forced', async () => {
    const clientIdentity = loadOrCreateIdentity(clientDir, {
      hostname: () => 'laptop',
    });
    const clientPeers = new PeerTable(clientDir);
    // Simulate a client that already holds a (fabricated) record for the
    // host's id under a different key — the only way this collision can
    // arise honestly is a hash collision, but the guard must hold
    // regardless of how the mismatch came about.
    const bogusKey = host.identity.publicKeyPem.replace('A', 'B');
    clientPeers.upsert({
      peerId: host.identity.peerId,
      label: 'old-workbox',
      publicKeyPem: bogusKey,
      endpoints: [],
    });

    const { url } = host.issuePairingUrl();
    await expect(
      pair(url, clientPeers, { identity: clientIdentity })
    ).rejects.toThrow(PeerKeyMismatchError);
    // The stored record must be untouched — this is the whole point.
    expect(clientPeers.get(host.identity.peerId)?.publicKeyPem).toBe(bogusKey);

    const { url: url2 } = host.issuePairingUrl();
    const result = await pair(url2, clientPeers, {
      identity: clientIdentity,
      force: true,
    });
    expect(result.peer.publicKeyPem).toBe(host.identity.publicKeyPem);
  });

  it('calls onBeforeCommit with the verified identity before anything is written', async () => {
    const clientIdentity = loadOrCreateIdentity(clientDir, {
      hostname: () => 'laptop',
    });
    const clientPeers = new PeerTable(clientDir);
    const { url } = host.issuePairingUrl();

    let sawDuringCallback: unknown;
    await pair(url, clientPeers, {
      identity: clientIdentity,
      onBeforeCommit: (info) => {
        expect(info.peerId).toBe(host.identity.peerId);
        expect(info.publicKeyPem).toBe(host.identity.publicKeyPem);
        // Read the *same* table instance pair() is about to write to, at
        // the instant the callback runs — this is what proves it fires
        // before the write, not merely before pair() returns.
        sawDuringCallback = clientPeers.get(info.peerId);
      },
    });
    expect(sawDuringCallback).toBeUndefined();
    expect(clientPeers.get(host.identity.peerId)).toBeDefined();
  });

  it('does not call onBeforeCommit when a key mismatch refuses the pair', async () => {
    const clientIdentity = loadOrCreateIdentity(clientDir, {
      hostname: () => 'laptop',
    });
    const clientPeers = new PeerTable(clientDir);
    const bogusKey = host.identity.publicKeyPem.replace('A', 'B');
    clientPeers.upsert({
      peerId: host.identity.peerId,
      label: 'old-workbox',
      publicKeyPem: bogusKey,
      endpoints: [],
    });

    const { url } = host.issuePairingUrl();
    const onBeforeCommit = vi.fn();
    await expect(
      pair(url, clientPeers, { identity: clientIdentity, onBeforeCommit })
    ).rejects.toThrow(PeerKeyMismatchError);
    expect(onBeforeCommit).not.toHaveBeenCalled();
  });
});

describe('dial()', () => {
  it('rejects an unknown peer before making any request', async () => {
    const clientIdentity = loadOrCreateIdentity(clientDir, {
      hostname: () => 'laptop',
    });
    const clientPeers = new PeerTable(clientDir);
    await expect(
      dial(host.baseUrl, 'not-a-real-peer', {
        identity: clientIdentity,
        peers: clientPeers,
      })
    ).rejects.toThrow(/unknown peer/);
  });

  it('rejects a revoked peer', async () => {
    const clientIdentity = loadOrCreateIdentity(clientDir, {
      hostname: () => 'laptop',
    });
    const clientPeers = new PeerTable(clientDir);
    const { url } = host.issuePairingUrl();
    const { peer } = await pair(url, clientPeers, { identity: clientIdentity });
    clientPeers.revoke(peer.peerId);
    await expect(
      dial(host.baseUrl, peer.peerId, {
        identity: clientIdentity,
        peers: clientPeers,
      })
    ).rejects.toThrow(/revoked/);
  });

  it('opens a live connection to the host after a successful mutual handshake', async () => {
    const clientIdentity = loadOrCreateIdentity(clientDir, {
      hostname: () => 'laptop',
    });
    const clientPeers = new PeerTable(clientDir);
    const { url } = host.issuePairingUrl();
    const { peer } = await pair(url, clientPeers, { identity: clientIdentity });

    const connection = await dial(host.baseUrl, peer.peerId, {
      identity: clientIdentity,
      peers: clientPeers,
    });
    expect(connection.peerId).toBe(host.identity.peerId);
    expect(host.connections.get(clientIdentity.peerId)).toBeDefined();
    connection.close();
  });

  it('A2: registers the dialed connection into the caller-supplied ConnectionRegistry', async () => {
    // The mailbox flusher looks connections up by peerId in whatever
    // registry it was built against — a dialed connection that never lands
    // in the caller's own registry would make every outbound-dialer case
    // silently undeliverable, and passing `host.connections` above would
    // not catch that: it only proves the *host's* side registered the
    // accepted connection, not that `dial()` did anything with the
    // registry it was given.
    const clientIdentity = loadOrCreateIdentity(clientDir, {
      hostname: () => 'laptop',
    });
    const clientPeers = new PeerTable(clientDir);
    const clientConnections = new ConnectionRegistry();
    const { url } = host.issuePairingUrl();
    const { peer } = await pair(url, clientPeers, { identity: clientIdentity });

    const connection = await dial(host.baseUrl, peer.peerId, {
      identity: clientIdentity,
      peers: clientPeers,
      connections: clientConnections,
    });

    expect(clientConnections.get(host.identity.peerId)).toBe(connection);
    connection.close();
  });

  it('rejects a host whose returned signature does not verify against the stored key', async () => {
    const clientIdentity = loadOrCreateIdentity(clientDir, {
      hostname: () => 'laptop',
    });
    const clientPeers = new PeerTable(clientDir);
    const { url } = host.issuePairingUrl();
    const { peer } = await pair(url, clientPeers, { identity: clientIdentity });

    // Simulate a swapped host key (e.g. a MITM, or a stale peer record):
    // the real host signs with its real key, but this client is checking
    // against a different one than the host actually holds.
    clientPeers.upsert({ ...peer, publicKeyPem: 'not-the-real-host-key' });

    await expect(
      dial(host.baseUrl, peer.peerId, {
        identity: clientIdentity,
        peers: clientPeers,
      })
    ).rejects.toThrow(AuthError);
  });
});
