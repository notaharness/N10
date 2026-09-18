import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MachineView } from '../host/contract-machines.js';

const { fork } = vi.hoisted(() => ({ fork: vi.fn() }));
vi.mock('electron', () => ({ utilityProcess: { fork } }));

import { BeamNodeBridge } from './beam-node-bridge.js';
import {
  getLastKnownMachines,
  setMachinesNotifier,
} from '../host/services/machines.js';

type Child = EventEmitter & {
  postMessage: ReturnType<typeof vi.fn>;
  kill: ReturnType<typeof vi.fn>;
};

function makeChild(): Child {
  return Object.assign(new EventEmitter(), {
    postMessage: vi.fn(),
    kill: vi.fn(),
  });
}

let child: Child;
let pushed: MachineView[][];

/** `request()` resolves the child through a promise chain even when it
 *  already exists, so `postMessage` lands a microtask after the call —
 *  flush that before inspecting the mock. */
function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

beforeEach(() => {
  child = makeChild();
  fork.mockReset().mockReturnValue(child);
  pushed = [];
  setMachinesNotifier((machines) => pushed.push(machines));
});

function localOnly(): MachineView {
  return {
    peerId: 'local-id',
    label: 'my-mac',
    isLocal: true,
    state: 'connected',
    transport: null,
    endpoints: [],
    lastSeenAt: null,
    queueDepth: 0,
    pairedAt: null,
    revokedAt: null,
  };
}

function peer(state: MachineView['state']): MachineView {
  return {
    peerId: 'peer-1',
    label: 'workbox',
    isLocal: false,
    state,
    transport: state === 'connected' ? 'WebSocket' : null,
    endpoints: ['http://a'],
    lastSeenAt: 1000,
    queueDepth: 0,
    pairedAt: 500,
    revokedAt: null,
  };
}

describe('BeamNodeBridge', () => {
  it('forks the worker lazily — not at construction', () => {
    void new BeamNodeBridge();
    expect(fork).not.toHaveBeenCalled();
  });

  it('round-trips a request by correlation id', async () => {
    const bridge = new BeamNodeBridge();
    const pending = bridge.listMachines();
    await tick();
    expect(fork).toHaveBeenCalledWith(
      expect.stringMatching(/beam-node-worker\.js$/),
      [],
      expect.objectContaining({ stdio: 'ignore' })
    );
    const sent = child.postMessage.mock.calls[0][0] as {
      id: number;
      op: string;
    };
    expect(sent.op).toBe('listMachines');
    child.emit('message', {
      kind: 'response',
      id: sent.id,
      ok: true,
      result: [localOnly()],
    });
    await expect(pending).resolves.toEqual([localOnly()]);
  });

  it('rejects the pending call when the worker answers ok:false', async () => {
    const bridge = new BeamNodeBridge();
    const pending = bridge.regeneratePairingUrl();
    await tick();
    const sent = child.postMessage.mock.calls[0][0] as { id: number };
    child.emit('message', {
      kind: 'response',
      id: sent.id,
      ok: false,
      error: 'not accepting connections',
    });
    await expect(pending).rejects.toThrow('not accepting connections');
  });

  it('reuses one worker across several calls', async () => {
    const bridge = new BeamNodeBridge();
    const first = bridge.listMachines();
    await tick();
    const firstId = (child.postMessage.mock.calls[0][0] as { id: number }).id;
    child.emit('message', {
      kind: 'response',
      id: firstId,
      ok: true,
      result: [],
    });
    await first;

    void bridge.getAcceptingStatus();
    await tick();
    expect(fork).toHaveBeenCalledTimes(1);
  });

  it('delivers a "changed" event straight into the machines service, no round trip', () => {
    const bridge = new BeamNodeBridge();
    void bridge.listMachines(); // forks the worker
    child.emit('message', {
      kind: 'event',
      name: 'changed',
      payload: [localOnly(), peer('reachable')],
    });
    expect(pushed).toHaveLength(1);
    expect(pushed[0]).toEqual([localOnly(), peer('reachable')]);
    expect(getLastKnownMachines()).toEqual([localOnly(), peer('reachable')]);
  });

  it('an unexpected exit surfaces every non-local, non-revoked machine as unreachable, then restarts after a backoff', async () => {
    vi.useFakeTimers();
    try {
      const bridge = new BeamNodeBridge();
      // Never answered before the crash below — its rejection is expected
      // and not the point of this test.
      bridge.listMachines().catch(() => undefined);
      await vi.advanceTimersByTimeAsync(0); // let the first fork settle
      child.emit('message', {
        kind: 'event',
        name: 'changed',
        payload: [localOnly(), peer('connected'), peer('revoked')],
      });
      pushed.length = 0;

      const dead = child;
      fork.mockReturnValue(makeChild());
      dead.emit('exit', 1);
      await vi.advanceTimersByTimeAsync(0);

      expect(pushed).toHaveLength(1);
      const synthetic = pushed[0];
      // Local is untouched — it is still this process.
      expect(synthetic.find((m) => m.isLocal)).toEqual(localOnly());
      // The connected peer now reads as unreachable, not "gone".
      const connectedPeer = synthetic.find(
        (m) => !m.isLocal && m.state !== 'revoked'
      );
      expect(connectedPeer?.state).toBe('unreachable');
      expect(connectedPeer?.transport).toBeNull();
      // Never silently "no machines": the list is never emptied by a crash.
      expect(synthetic.length).toBe(3);
      // Not re-forked instantly — the restart is backed off.
      expect(fork).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(500);
      expect(fork).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives up restarting after a bounded number of repeated exits, rather than forking forever (finding 2)', async () => {
    vi.useFakeTimers();
    try {
      const bridge = new BeamNodeBridge();
      bridge.listMachines().catch(() => undefined);
      await vi.advanceTimersByTimeAsync(0);

      // Every restart forks a new child that immediately dies again —
      // the worst case: a config error the worker itself never catches.
      for (let i = 0; i < 10; i += 1) {
        const dead = child;
        fork.mockReturnValue(makeChild());
        dead.emit('exit', 1);
        await vi.advanceTimersByTimeAsync(60_000);
        child = fork.mock.results.at(-1)?.value as Child;
      }

      // Bounded: the fork count stops growing well short of 10 more
      // attempts, instead of matching every exit 1:1 forever.
      const forkCount = fork.mock.calls.length;
      expect(forkCount).toBeLessThan(10);
      const deadAgain = child;
      fork.mockClear();
      deadAgain.emit('exit', 1);
      await vi.advanceTimersByTimeAsync(120_000);
      expect(fork).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('closes every open pty stream on an unexpected exit, so its backend learns the transport died (finding 1)', async () => {
    const bridge = new BeamNodeBridge();
    const opening = bridge.ptyOpen('peer-1', { cols: 80, rows: 24 });
    await tick();
    const openReq = child.postMessage.mock.calls.find(
      (c) => (c[0] as { op: string }).op === 'ptyOpen'
    )?.[0] as { id: number };
    child.emit('message', {
      kind: 'response',
      id: openReq.id,
      ok: true,
      result: { streamId: 'pty-1' },
    });
    const { streamId } = await opening;

    const events: { kind: string; streamId: string }[] = [];
    bridge.onPtyEvent((e) => events.push(e));

    child.emit('exit', 1);
    await tick();

    expect(events).toEqual([{ kind: 'closed', streamId }]);
  });

  it('cross-wire: a stale handle from a dead worker can neither write into nor receive from the replacement worker’s same-numbered stream (finding 1)', async () => {
    const bridge = new BeamNodeBridge();

    // Generation 1: open a stream, worker calls it "pty-1".
    const firstOpen = bridge.ptyOpen('peer-1', { cols: 80, rows: 24 });
    await tick();
    const firstReq = child.postMessage.mock.calls.find(
      (c) => (c[0] as { op: string }).op === 'ptyOpen'
    )?.[0] as { id: number };
    child.emit('message', {
      kind: 'response',
      id: firstReq.id,
      ok: true,
      result: { streamId: 'pty-1' },
    });
    const staleHandle = await firstOpen;

    // The worker dies and a replacement forks — its own stream ids
    // restart at 1 too (RemoteOps.nextStreamId, per-process).
    const dead = child;
    const replacement = makeChild();
    fork.mockReturnValue(replacement);
    dead.emit('exit', 1);
    await tick();
    child = replacement;

    const secondOpen = bridge.ptyOpen('peer-1', { cols: 80, rows: 24 });
    await tick();
    const secondReq = child.postMessage.mock.calls.find(
      (c) => (c[0] as { op: string }).op === 'ptyOpen'
    )?.[0] as { id: number };
    child.emit('message', {
      kind: 'response',
      id: secondReq.id,
      ok: true,
      result: { streamId: 'pty-1' }, // same raw id as generation 1
    });
    const freshHandle = await secondOpen;
    expect(freshHandle.streamId).not.toBe(staleHandle.streamId);

    // Write on the stale handle must never reach the replacement
    // worker's "pty-1".
    child.postMessage.mockClear();
    bridge.ptyWrite(staleHandle.streamId, 'oops');
    await tick();
    expect(child.postMessage).not.toHaveBeenCalled();

    // And the replacement's own data for its "pty-1" must only be
    // delivered under the fresh handle's id, never the stale one.
    const received: { kind: 'data'; streamId: string; data: string }[] = [];
    bridge.onPtyEvent((e) => {
      if (e.kind === 'data') received.push(e);
    });
    child.emit('message', {
      kind: 'event',
      name: 'pty-data',
      payload: { streamId: 'pty-1', data: 'hello' },
    });
    expect(received).toEqual([
      { kind: 'data', streamId: freshHandle.streamId, data: 'hello' },
    ]);
  });

  it('a clean shutdown does not trigger the crash-restart path', async () => {
    const bridge = new BeamNodeBridge();
    // Never answered — the node exits for shutdown, not with a reply.
    bridge.listMachines().catch(() => undefined);
    await tick();
    const shutdownPromise = bridge.shutdown();
    await tick();
    const shutdownReq = child.postMessage.mock.calls.find(
      (c) => (c[0] as { op: string }).op === 'shutdown'
    )?.[0] as { id: number };
    child.emit('message', {
      kind: 'response',
      id: shutdownReq.id,
      ok: true,
      result: undefined,
    });
    child.emit('exit', 0);
    await shutdownPromise;
    expect(pushed).toEqual([]); // no synthetic "everyone unreachable" push
  });
});
