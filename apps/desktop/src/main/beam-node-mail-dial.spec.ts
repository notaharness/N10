/**
 * Queued mail actually going out, over two real nodes on loopback.
 *
 * `send()` tells the user "beam will deliver this message the next time
 * that machine comes online". The mailbox's flush triggers are a
 * connection becoming live, node start, and a retry while connected —
 * all of which need a connection, and nothing in the desktop ever made
 * one: the reachability prober fetches a descriptor over HTTP and stops
 * there. So a desktop with mail waiting and a peer showing "Reachable"
 * sat there indefinitely, having promised otherwise.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OutboundQueue, type Envelope } from '@n10/beam';
import { BeamNode } from './beam-node.js';
import type { PairConfirmResult } from '../host/contract-machines.js';

let dirA: string;
let dirB: string;
let a: BeamNode;
let b: BeamNode;

beforeEach(() => {
  dirA = mkdtempSync(join(tmpdir(), 'beam-maildial-a-'));
  dirB = mkdtempSync(join(tmpdir(), 'beam-maildial-b-'));
  a = new BeamNode({
    beamDir: dirA,
    hostname: () => 'workbox',
    probeIntervalMs: 30,
    probeTimeoutMs: 2000,
  });
  b = new BeamNode({
    beamDir: dirB,
    hostname: () => 'laptop',
    probeIntervalMs: 30,
    probeTimeoutMs: 2000,
  });
});

afterEach(async () => {
  await a.dispose();
  await b.dispose();
  rmSync(dirA, { recursive: true, force: true });
  rmSync(dirB, { recursive: true, force: true });
});

async function waitFor(check: () => boolean, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function must(
  promise: Promise<PairConfirmResult>
): Promise<Extract<PairConfirmResult, { ok: true }>> {
  const result = await promise;
  if (!result.ok) throw new Error('expected ok result');
  return result;
}

function envelope(from: string, to: string): Envelope {
  return {
    id: 'env-1',
    from,
    to,
    seq: 1,
    topic: 'orchestra',
    payload: 'a report from an earlier session',
    encoding: 'utf8',
    createdAt: Date.now(),
  };
}

function stateOf(node: BeamNode, peerId: string): string | undefined {
  return node.listMachines().find((m) => m.peerId === peerId)?.state;
}

describe('a node with mail waiting for a peer', () => {
  it('dials that peer when a probe finds it reachable, and the queue drains', async () => {
    const status = await a.startAccepting();
    const { machine } = await must(b.confirmPairing(status.pairingUrl!));
    const local = b.listMachines().find((m) => m.isLocal);

    // Mail left over from an earlier session: on disk, addressed, with
    // no connection anywhere and nothing about to make one.
    const queue = new OutboundQueue(dirB);
    queue.enqueue(machine.peerId, envelope(local!.peerId, machine.peerId));
    expect(queue.list(machine.peerId)).toHaveLength(1);
    expect(stateOf(b, machine.peerId)).not.toBe('connected');

    // Nothing else happens here: no op is run, no reconnect is asked
    // for. The only event is the prober finding the peer reachable.
    await waitFor(() => queue.list(machine.peerId).length === 0);
    expect(stateOf(b, machine.peerId)).toBe('connected');
  });

  it('leaves a reachable peer alone when there is nothing to send', async () => {
    const status = await a.startAccepting();
    const { machine } = await must(b.confirmPairing(status.pairingUrl!));

    // Long enough for many probe intervals: the prober is running and
    // finding this peer, it just has no reason to dial it.
    await waitFor(() => stateOf(b, machine.peerId) === 'reachable');
    await new Promise((r) => setTimeout(r, 300));

    expect(stateOf(b, machine.peerId)).toBe('reachable');
  });
});
