import { rmSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Host, PeerTable, loadOrCreateIdentity } from '@n10/beam';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runPair } from './pair.js';
import { makeFakeIoWithBeamDir, type FakeIo } from '../test-support/fake-io.js';

let io: FakeIo;
let beamDir: string;
let remoteDir: string;
let host: Host;

beforeEach(() => {
  ({ io, beamDir } = makeFakeIoWithBeamDir());
  remoteDir = mkdtempSync(join(tmpdir(), 'beam-pair-remote-'));
});

afterEach(async () => {
  await host.close();
  rmSync(beamDir, { recursive: true, force: true });
  rmSync(remoteDir, { recursive: true, force: true });
});

async function startRemote(
  hostname = 'workbox'
): Promise<{ url: string; peerId: string }> {
  const identity = loadOrCreateIdentity(remoteDir, {
    hostname: () => hostname,
  });
  const peers = new PeerTable(remoteDir);
  host = new Host({ identity, peers, port: 0 });
  await host.listen();
  return { url: host.issuePairingUrl().url, peerId: identity.peerId };
}

describe('beam pair', () => {
  it('prints the peer label and its fingerprint in groups of four before confirming', async () => {
    const { url, peerId } = await startRemote();
    const code = await runPair([url], io);
    expect(code).toBe(0);
    const text = io.stdoutText();
    expect(text).toContain('workbox — fingerprint');
    // Groups of four hex characters, several of them, space separated.
    expect(text).toMatch(/fingerprint ([0-9a-f]{4} ){3,}[0-9a-f]{4}/);
    // The fingerprint's first group is the derived peer id's first four
    // characters — same hash, same machine.
    expect(text).toContain(peerId.slice(0, 4));
    expect(io.stdoutText()).toContain(`paired with "workbox" (${peerId})`);
  });

  it('refuses to replace an already-held peer id under a mismatched key without --force, and writes nothing', async () => {
    // Simulate a genuine id collision locally: store a fabricated peer
    // record under the id the remote will actually present, with a
    // different key, then pair for real and confirm --force is required
    // and, when given, replaces it.
    const { peerId } = await startRemote();
    const peers = new PeerTable(beamDir);
    peers.upsert({
      peerId,
      label: 'workbox',
      publicKeyPem: 'a different key entirely',
      endpoints: [],
    });

    // Pairing tokens are single-use even on a refused attempt, so each try
    // needs its own freshly minted URL.
    const refused = await runPair([host.issuePairingUrl().url], io);
    expect(refused).toBe(1);
    expect(io.stderrText()).toMatch(/reinstalled|impostor/);
    expect(io.stderrText()).toContain('--force');
    expect(new PeerTable(beamDir).get(peerId)?.publicKeyPem).toBe(
      'a different key entirely'
    );

    const accepted = await runPair([host.issuePairingUrl().url, '--force'], io);
    expect(accepted).toBe(0);
    expect(new PeerTable(beamDir).get(peerId)?.publicKeyPem).not.toBe(
      'a different key entirely'
    );
  });
});
