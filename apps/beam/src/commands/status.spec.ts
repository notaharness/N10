import { rmSync } from 'node:fs';
import { PeerTable } from '@n10/beam';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runStatus } from './status.js';
import { makeFakeIoWithBeamDir, type FakeIo } from '../test-support/fake-io.js';

let io: FakeIo;
let beamDir: string;

beforeEach(() => {
  ({ io, beamDir } = makeFakeIoWithBeamDir());
});

afterEach(() => {
  rmSync(beamDir, { recursive: true, force: true });
});

describe('beam status', () => {
  it('--json includes identity, running state and a peer summary', async () => {
    const peers = new PeerTable(beamDir);
    peers.upsert({
      peerId: 'aaaaaaaaaaaaaaaa',
      label: 'workbox',
      publicKeyPem: 'key-a',
      endpoints: ['http://10.0.0.5:4000'],
    });

    const code = await runStatus(['--json'], io);
    expect(code).toBe(0);
    const parsed = JSON.parse(io.stdoutText()) as Record<string, unknown>;
    expect(typeof parsed['peerId']).toBe('string');
    expect(typeof parsed['label']).toBe('string');
    expect(parsed['running']).toBe(false);
    expect(parsed['peers']).toMatchObject({ total: 1, connected: 0 });
  });

  it('human output says the node is not running when no node is up', async () => {
    const code = await runStatus([], io);
    expect(code).toBe(0);
    expect(io.stdoutText()).toContain('not running');
  });
});
