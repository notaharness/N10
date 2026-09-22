/**
 * End-to-end proof of Phase 2, two real nodes (Host + WebSocket dial, not
 * an in-memory transport) in one process: A serves, B pairs, B dials A,
 * B runs a command over `exec`, A sends B a message over `msg` while
 * connected, then the connection drops, A sends again (queued), and on
 * reconnect B sees it delivered exactly once.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConnectionRegistry } from '../connection-registry.js';
import { dial, pair } from '../client.js';
import {
  createExecStreamHandler,
  decodeExecExit,
  demuxExecData,
  EXEC_CHANNEL_STDOUT,
} from '../exec-handler.js';
import { Host } from '../host.js';
import { loadOrCreateIdentity } from '../identity.js';
import { PeerTable } from '../peer-table.js';
import { StreamRegistry } from '../stream-registry.js';
import type { Envelope } from './envelope.js';
import { Mailbox } from './mailbox.js';

let dirA: string;
let dirB: string;
let hostA: Host;

beforeEach(() => {
  dirA = mkdtempSync(join(tmpdir(), 'beam-p2-e2e-a-'));
  dirB = mkdtempSync(join(tmpdir(), 'beam-p2-e2e-b-'));
});

afterEach(async () => {
  await hostA.close();
  rmSync(dirA, { recursive: true, force: true });
  rmSync(dirB, { recursive: true, force: true });
});

async function waitFor<T>(
  read: () => T,
  predicate: (value: T) => boolean,
  timeoutMs = 5000
): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = read();
    if (predicate(value)) return value;
    if (Date.now() - started > timeoutMs) {
      throw new Error('timed out waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe('Phase 2 end to end: pair, dial, exec, and the mailbox over a real connection', () => {
  it(
    'runs a command over exec and drains queued mail exactly once after a reconnect',
    { timeout: 20000 },
    async () => {
      const identityA = loadOrCreateIdentity(dirA, {
        hostname: () => 'workbox',
      });
      const peersA = new PeerTable(dirA);
      const registryA = new StreamRegistry();
      const connectionsA = new ConnectionRegistry();
      hostA = new Host({
        identity: identityA,
        peers: peersA,
        registry: registryA,
        connections: connectionsA,
        port: 0,
        capabilities: ['streams', 'exec', 'msg'],
      });
      registryA.register('exec', createExecStreamHandler());
      const mailboxA = new Mailbox({
        identity: identityA,
        peers: peersA,
        connections: connectionsA,
        registry: registryA,
        beamDir: dirA,
        ackTimeoutMs: 300,
        retryIntervalMs: 50,
        sendAwaitMs: 500,
      });
      await hostA.listen();

      const identityB = loadOrCreateIdentity(dirB, {
        hostname: () => 'laptop',
      });
      const peersB = new PeerTable(dirB);
      const registryB = new StreamRegistry();
      let connectionsB = new ConnectionRegistry();
      const receivedByB: Envelope[] = [];
      let mailboxB = new Mailbox({
        identity: identityB,
        peers: peersB,
        connections: connectionsB,
        registry: registryB,
        beamDir: dirB,
        ackTimeoutMs: 300,
        retryIntervalMs: 50,
        sendAwaitMs: 500,
      });
      mailboxB.onMessage((e) => receivedByB.push(e));

      const { url } = hostA.issuePairingUrl();
      await pair(url, peersB, { identity: identityB });

      let connectionB = await dial(hostA.baseUrl, identityA.peerId, {
        identity: identityB,
        peers: peersB,
        registry: registryB,
        connections: connectionsB,
      });

      // exec: run a real command on A, from B.
      const execStream = await connectionB.openStream('exec', {
        argv: ['echo', 'exec-over-p2'],
      });
      const stdoutChunks: Uint8Array[] = [];
      execStream.onData((data) => {
        const { channel, payload } = demuxExecData(data);
        if (channel === EXEC_CHANNEL_STDOUT) stdoutChunks.push(payload);
      });
      let exitReason: string | undefined;
      execStream.onClose((reason) => {
        exitReason = reason;
      });
      await waitFor(
        () => exitReason,
        (r) => r !== undefined
      );
      const exit = decodeExecExit(exitReason);
      expect(exit?.exitCode).toBe(0);
      expect(
        stdoutChunks.map((c) => Buffer.from(c).toString('utf8')).join('')
      ).toContain('exec-over-p2');

      // msg, while connected: delivered.
      const first = await mailboxA.send({
        to: identityB.peerId,
        topic: 'orchestra',
        payload: 'first',
      });
      expect(first.outcome).toBe('delivered');
      await waitFor(
        () => receivedByB.map((e) => e.payload),
        (p) => p.includes('first')
      );

      // Drop B's side of the connection, then send again: queued.
      connectionB.close();
      await waitFor(
        () => connectionsA.get(identityB.peerId),
        (c) => c === undefined
      );

      const second = await mailboxA.send({
        to: identityB.peerId,
        topic: 'orchestra',
        payload: 'second',
      });
      expect(second.outcome).toBe('queued');

      // B "restarts" (fresh in-memory state, same beamDir) and reconnects.
      connectionsB = new ConnectionRegistry();
      mailboxB = new Mailbox({
        identity: identityB,
        peers: peersB,
        connections: connectionsB,
        registry: registryB,
        beamDir: dirB,
        ackTimeoutMs: 300,
        retryIntervalMs: 50,
        sendAwaitMs: 500,
      });
      const receivedAfterRestart: Envelope[] = [];
      mailboxB.onMessage((e) => receivedAfterRestart.push(e));

      connectionB = await dial(hostA.baseUrl, identityA.peerId, {
        identity: identityB,
        peers: peersB,
        registry: registryB,
        connections: connectionsB,
      });

      await waitFor(
        () => receivedAfterRestart.map((e) => e.payload),
        (p) => p.includes('second')
      );
      // Delivered exactly once: no duplicate of "first" resurfaces either.
      expect(receivedAfterRestart.map((e) => e.payload)).toEqual(['second']);

      connectionB.close();
    }
  );
});
