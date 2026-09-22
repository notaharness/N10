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
import { OutboundQueue, type Envelope, type PeerStatus } from '@n10/beam';
import { BeamNode } from './beam-node.js';
import { QueuedMailDialer } from './beam-node-mail-dial.js';
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

/** A peer with mail waiting and no connection — the only state in which
 *  this dialer does anything at all. */
function waiting(peerId: string, queueDepth = 1): PeerStatus[] {
  return [
    {
      peerId,
      label: 'workbox',
      revoked: false,
      state: 'reachable',
      queueDepth,
    },
  ];
}

describe('a peer that refuses the dial', () => {
  const PEER = 'bbbbbbbbbbbbbbbb';

  function dialerThatFails() {
    const attempts: number[] = [];
    const dialer = new QueuedMailDialer({
      connections: { get: () => undefined },
      status: () => waiting(PEER),
      connect: () => {
        attempts.push(Date.now());
        return Promise.reject(new Error('challenge request failed: 403'));
      },
      log: () => undefined,
    });
    return { dialer, attempts };
  }

  /** Let the rejected dial's handlers run. */
  async function settle(): Promise<void> {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  }

  it('is not dialed on every probe once it has started refusing', async () => {
    // A machine that has revoked us answers the prober's unauthenticated
    // descriptor request — it is running, it is reachable — and then
    // 403s the challenge behind every dial, for as long as the
    // revocation stands. The mail has to stay queued (a revocation can
    // be lifted), so the only thing left to change is how often we ask.
    const { dialer, attempts } = dialerThatFails();

    for (let tick = 0; tick < 40; tick += 1) {
      dialer.onReachable(PEER);
      await settle();
    }

    // Doubling up to the cap: ticks 1, 2, 4, 7, 12, 21, 30, 39 — eight
    // attempts where every tick would have made forty.
    expect(attempts.length).toBeLessThan(10);
    expect(attempts.length).toBeGreaterThan(0);
  });

  it('tries again immediately once it stops refusing', async () => {
    // Backing off must not become giving up: the peer is still holding
    // this machine's mail, and the retry is the only thing that will
    // ever deliver it.
    let refuse = true;
    const attempts: string[] = [];
    const dialer = new QueuedMailDialer({
      connections: { get: () => undefined },
      status: () => waiting(PEER),
      connect: (peerId) => {
        attempts.push(peerId);
        return refuse
          ? Promise.reject(new Error('challenge request failed: 403'))
          : Promise.resolve({});
      },
      log: () => undefined,
    });

    for (let tick = 0; tick < 20; tick += 1) {
      dialer.onReachable(PEER);
      await settle();
    }
    const whileRefusing = attempts.length;
    refuse = false;

    // Enough ticks to get past the skip the last failure bought.
    for (let tick = 0; tick < 10; tick += 1) {
      dialer.onReachable(PEER);
      await settle();
    }
    const afterSuccess = attempts.length;
    expect(afterSuccess).toBeGreaterThan(whileRefusing);

    // And the count of consecutive failures is back to zero with it, so
    // a single later refusal costs one skipped tick rather than the
    // eight the earlier run had climbed to.
    refuse = true;
    dialer.onReachable(PEER);
    await settle();
    const afterOneFailure = attempts.length;
    expect(afterOneFailure).toBe(afterSuccess + 1);

    refuse = false;
    dialer.onReachable(PEER);
    await settle();
    expect(attempts.length).toBe(afterOneFailure); // the one skip
    dialer.onReachable(PEER);
    await settle();
    expect(attempts.length).toBe(afterOneFailure + 1);
  });

  it('never dials a peer with nothing queued, however reachable', async () => {
    const attempts: string[] = [];
    const dialer = new QueuedMailDialer({
      connections: { get: () => undefined },
      status: () => waiting(PEER, 0),
      connect: (peerId) => {
        attempts.push(peerId);
        return Promise.resolve({});
      },
      log: () => undefined,
    });

    for (let tick = 0; tick < 5; tick += 1) {
      dialer.onReachable(PEER);
      await settle();
    }

    expect(attempts).toEqual([]);
  });
});
