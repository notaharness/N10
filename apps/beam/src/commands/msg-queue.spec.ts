import { rmSync } from 'node:fs';
import { Mailbox, PeerTable, loadOrCreateIdentity } from '@n10/beam';
import { ConnectionRegistry, StreamRegistry } from '@n10/beam';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMsgQueue } from './msg-queue.js';
import { makeFakeIoWithBeamDir, type FakeIo } from '../test-support/fake-io.js';

let io: FakeIo;
let beamDir: string;

beforeEach(() => {
  ({ io, beamDir } = makeFakeIoWithBeamDir());
});

afterEach(() => {
  rmSync(beamDir, { recursive: true, force: true });
});

async function queueOneMessage(): Promise<{ peerId: string; label: string }> {
  const identity = loadOrCreateIdentity(beamDir, { hostname: () => 'laptop' });
  const peers = new PeerTable(beamDir);
  const peer = peers.upsert({
    peerId: 'aaaaaaaaaaaaaaaa',
    label: 'workbox',
    publicKeyPem: 'key-a',
    endpoints: [],
  });
  const mailbox = new Mailbox({
    identity,
    peers,
    connections: new ConnectionRegistry(),
    registry: new StreamRegistry(),
    beamDir,
    sendAwaitMs: 20,
  });
  await mailbox.send({ to: peer.peerId, topic: 'orchestra', payload: 'hello' });
  mailbox.dispose();
  return { peerId: peer.peerId, label: peer.label };
}

describe('beam msg queue', () => {
  it('says nothing is queued when the queue is empty', async () => {
    const code = await runMsgQueue([], io);
    expect(code).toBe(0);
    expect(io.stdoutText()).toContain('Nothing queued');
  });

  it('--json lists the queued envelope with peer, topic and byte count, oldest first', async () => {
    const { label } = await queueOneMessage();
    const code = await runMsgQueue(['--json'], io);
    expect(code).toBe(0);
    const parsed = JSON.parse(io.stdoutText()) as {
      queued: Record<string, unknown>[];
    };
    expect(parsed.queued).toHaveLength(1);
    expect(parsed.queued[0]).toMatchObject({
      label,
      topic: 'orchestra',
      seq: 1,
    });
    expect(parsed.queued[0]?.['bytes']).toBeGreaterThan(0);
  });

  it('the human table names the peer and topic for what is waiting', async () => {
    const { label } = await queueOneMessage();
    const code = await runMsgQueue([], io);
    expect(code).toBe(0);
    const text = io.stdoutText();
    expect(text).toContain(label);
    expect(text).toContain('orchestra');
  });
});
