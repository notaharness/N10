import { rmSync } from 'node:fs';
import { PeerTable } from '@n10/beam';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runPeers } from './peers.js';
import { makeFakeIoWithBeamDir, type FakeIo } from '../test-support/fake-io.js';

let io: FakeIo;
let beamDir: string;

beforeEach(() => {
  ({ io, beamDir } = makeFakeIoWithBeamDir());
});

afterEach(() => {
  rmSync(beamDir, { recursive: true, force: true });
});

describe('beam peers', () => {
  it('reports no paired peers instead of an empty table', async () => {
    const code = await runPeers([], io);
    expect(code).toBe(0);
    expect(io.stdoutText()).toContain('No paired peers');
  });

  it('renders no-endpoint as a normal condition and unknown for a peer with an endpoint', async () => {
    const peers = new PeerTable(beamDir);
    peers.upsert({
      peerId: 'aaaaaaaaaaaaaaaa',
      label: 'laptop',
      publicKeyPem: 'key-a',
      endpoints: [],
    });
    peers.upsert({
      peerId: 'bbbbbbbbbbbbbbbb',
      label: 'workbox',
      publicKeyPem: 'key-b',
      endpoints: ['http://10.0.0.5:4000'],
    });

    const code = await runPeers([], io);
    expect(code).toBe(0);
    const text = io.stdoutText();
    expect(text).toMatch(/laptop.*no-endpoint/s);
    expect(text).toContain('can reach us only');
    expect(text).toMatch(/workbox.*unknown/s);
  });

  it('leaves the QUEUED column blank at zero and shows the label, not the raw revoked flag, for a revoked peer', async () => {
    const peers = new PeerTable(beamDir);
    peers.upsert({
      peerId: 'aaaaaaaaaaaaaaaa',
      label: 'old-box',
      publicKeyPem: 'key-a',
      endpoints: [],
    });
    peers.revoke('aaaaaaaaaaaaaaaa');

    await runPeers([], io);
    const line = io.stdoutLines().find((l) => l.includes('old-box'));
    expect(line).toBeDefined();
    expect(line).toContain('(revoked)');
    // QUEUED is the last column; blank at zero means the line does not end
    // in a stray digit run for this peer, which never had anything queued.
    expect(line?.trimEnd()).not.toMatch(/\d$/);
  });

  it('--json prints one parseable array with the documented fields', async () => {
    const peers = new PeerTable(beamDir);
    peers.upsert({
      peerId: 'aaaaaaaaaaaaaaaa',
      label: 'workbox',
      publicKeyPem: 'key-a',
      endpoints: ['http://10.0.0.5:4000'],
    });

    const code = await runPeers(['--json'], io);
    expect(code).toBe(0);
    const rows = JSON.parse(io.stdoutText()) as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      peerId: 'aaaaaaaaaaaaaaaa',
      label: 'workbox',
      state: 'unknown',
      endpoint: 'http://10.0.0.5:4000',
      queueDepth: 0,
    });
  });
});
