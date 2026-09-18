import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ConnectionRegistry,
  Mailbox,
  PeerTable,
  StreamRegistry,
  dial,
  loadOrCreateIdentity,
  pair,
} from '@n10/beam';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { run } from '../run.js';
import {
  makeFakeIo,
  makeFakeIoWithBeamDir,
  waitFor,
  type FakeIo,
} from '../test-support/fake-io.js';
import { startNode, type NodeHandle } from '../node.js';

let io: FakeIo;
let beamDir: string;
let senderDir: string;
let a: NodeHandle;

beforeEach(async () => {
  ({ io, beamDir } = makeFakeIoWithBeamDir());
  senderDir = mkdtempSync(join(tmpdir(), 'beam-listen-sender-'));
  a = await startNode(io, { hostname: '127.0.0.1', port: 0 });
});

afterEach(async () => {
  await a.close();
  rmSync(beamDir, { recursive: true, force: true });
  rmSync(senderDir, { recursive: true, force: true });
});

/** Have a separate machine (B) pair with A and send it exactly one
 * message, entirely at the library level — the CLI under test only ever
 * sees the receiving side, A. */
async function senderDeliversOneMessage(payload: string): Promise<void> {
  const identityB = loadOrCreateIdentity(senderDir, {
    hostname: () => 'sender',
  });
  const peersB = new PeerTable(senderDir);
  await pair(a.host.issuePairingUrl().url, peersB, { identity: identityB });
  const connectionsB = new ConnectionRegistry();
  const registryB = new StreamRegistry();
  const connection = await dial(a.host.baseUrl, a.identity.peerId, {
    identity: identityB,
    peers: peersB,
    registry: registryB,
    connections: connectionsB,
  });
  const mailboxB = new Mailbox({
    identity: identityB,
    peers: peersB,
    connections: connectionsB,
    registry: registryB,
    beamDir: senderDir,
  });
  const outcome = await mailboxB.send({
    to: a.identity.peerId,
    topic: 'orchestra',
    payload,
  });
  expect(outcome.outcome).toBe('delivered');
  mailboxB.dispose();
  connection.close();
}

describe('beam msg listen --require-ack', () => {
  it('holds an envelope until acked, and redelivers it if the listener exits without acking', async () => {
    await senderDeliversOneMessage('report-1');

    const firstListen = makeFakeIo(io.env);
    const controller1 = new AbortController();
    firstListen.signal = controller1.signal;
    const firstRun = run(['msg', 'listen', '--require-ack'], firstListen);

    await waitFor(
      () => firstListen.stdoutText(),
      (text) => text.includes('report-1')
    );
    const firstEnvelope = JSON.parse(firstListen.stdoutText().trim()) as {
      id: string;
    };

    // Exit without acking — nothing on stdin.
    controller1.abort();
    expect(await firstRun).toBe(0);

    // Resubscribe: the same, unacknowledged envelope comes back.
    const secondListen = makeFakeIo(io.env);
    const controller2 = new AbortController();
    secondListen.signal = controller2.signal;
    const secondRun = run(['msg', 'listen', '--require-ack'], secondListen);

    await waitFor(
      () => secondListen.stdoutText(),
      (text) => text.includes('report-1')
    );
    const secondEnvelope = JSON.parse(secondListen.stdoutText().trim()) as {
      id: string;
    };
    expect(secondEnvelope.id).toBe(firstEnvelope.id);

    // This time, ack it before exiting.
    secondListen.stdin.push(`${secondEnvelope.id}\n`);
    controller2.abort();
    expect(await secondRun).toBe(0);
  });

  it('refuses without a running node — there is nothing to hold an envelope in', async () => {
    await a.close();
    const code = await run(['msg', 'listen', '--require-ack'], io);
    expect(code).toBe(1);
    expect(io.stderrText()).toContain('--require-ack needs a running node');
    // Restart a fresh node so afterEach's close() has something to close.
    a = await startNode(io, { hostname: '127.0.0.1', port: 0 });
  });
});
