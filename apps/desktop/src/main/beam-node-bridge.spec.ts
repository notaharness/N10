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

  it('an unexpected exit surfaces every non-local, non-revoked machine as unreachable, then restarts', async () => {
    const bridge = new BeamNodeBridge();
    // Never answered before the crash below — its rejection is expected
    // and not the point of this test.
    bridge.listMachines().catch(() => undefined);
    await tick(); // let the first fork's internal bookkeeping settle
    child.emit('message', {
      kind: 'event',
      name: 'changed',
      payload: [localOnly(), peer('connected'), peer('revoked')],
    });
    pushed.length = 0;

    const dead = child;
    fork.mockReturnValue(makeChild());
    dead.emit('exit', 1);
    await tick(); // let the restart's ensureChild() actually fork

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
    // Restarted, not left dead: a fresh child was forked.
    expect(fork).toHaveBeenCalledTimes(2);
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
