/**
 * End-to-end proof of Phase 1, two nodes in one process: A serves, B pairs
 * with A over loopback HTTP, B dials A for the stream connection, B opens a
 * `pty` stream and sees real output from a command it ran on A's machine.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dial, pair } from './client.js';
import { Host } from './host.js';
import { derivePeerId, loadOrCreateIdentity } from './identity.js';
import { PeerTable } from './peer-table.js';
import { createPtyStreamHandler } from './pty-handler.js';

let dirA: string;
let dirB: string;
let hostA: Host;

beforeEach(() => {
  dirA = mkdtempSync(join(tmpdir(), 'beam-e2e-a-'));
  dirB = mkdtempSync(join(tmpdir(), 'beam-e2e-b-'));
});

afterEach(async () => {
  await hostA.close();
  rmSync(dirA, { recursive: true, force: true });
  rmSync(dirB, { recursive: true, force: true });
});

describe('beam end to end: pair, dial, pty', () => {
  it('B sees real pty output from a command run on A, over a paired and authenticated connection', async () => {
    const identityA = loadOrCreateIdentity(dirA, { hostname: () => 'workbox' });
    const peersA = new PeerTable(dirA);
    hostA = new Host({
      identity: identityA,
      peers: peersA,
      port: 0,
      capabilities: ['streams', 'pty'],
    });
    hostA.registry.register('pty', createPtyStreamHandler());
    await hostA.listen();

    const identityB = loadOrCreateIdentity(dirB, { hostname: () => 'laptop' });
    const peersB = new PeerTable(dirB);

    const { url } = hostA.issuePairingUrl();
    const { peer: paired } = await pair(url, peersB, { identity: identityB });

    // Pairing is symmetric: both tables now hold the other's public key,
    // and each side independently derived the same id for it. Comparing
    // against `derivePeerId` (not merely `identityA.peerId`) is what fails
    // if the client ever stores an id the host merely asserted (A3).
    expect(paired.peerId).toBe(derivePeerId(paired.publicKeyPem));
    expect(paired.peerId).toBe(identityA.peerId);
    expect(peersA.get(identityB.peerId)?.publicKeyPem).toBe(
      identityB.publicKeyPem
    );

    const connection = await dial(hostA.baseUrl, identityA.peerId, {
      identity: identityB,
      peers: peersB,
    });
    expect(connection.peerId).toBe(identityA.peerId);

    const stream = await connection.openStream('pty');
    const chunks: Uint8Array[] = [];
    stream.onData((data) => chunks.push(data));

    stream.write(new TextEncoder().encode('echo beam-e2e-marker-42\n'));

    const marker = 'beam-e2e-marker-42';
    const output = await waitForText(
      () => chunks.map((c) => new TextDecoder().decode(c)).join(''),
      marker
    );
    expect(output).toContain(marker);

    stream.close();
    connection.close();
  });
});

async function waitForText(
  read: () => string,
  marker: string,
  timeoutMs = 5000
): Promise<string> {
  const started = Date.now();
  for (;;) {
    const text = read();
    if (text.includes(marker)) return text;
    if (Date.now() - started > timeoutMs)
      throw new Error(`timed out waiting for "${marker}" in pty output`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
