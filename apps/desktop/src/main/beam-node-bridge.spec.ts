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

/** The first backoff step. A replacement worker only exists once this
 *  has elapsed: every path that wants a child — an ordinary request
 *  included — joins the armed restart rather than forking around its
 *  spacing, so a test that needs generation 2 must wait for it. */
const FIRST_RESTART_MS = 500;

/** `tick()` under fake timers: `setImmediate` is faked too, so the
 *  microtask flush has to come from the clock. */
function settle(ms = 0): Promise<void> {
  return vi.advanceTimersByTimeAsync(ms);
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
    inboundWaiting: [],
    inboundRefused: [],
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
    inboundWaiting: [],
    inboundRefused: [],
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

      // Second-pass finding 3: the cap lived only on the exit path —
      // `ensureChild` refused to fork solely on `shuttingDown` — so an
      // ordinary request after the budget ran out forked again anyway,
      // once per poll tick, forever. An exhausted budget must also
      // reject a fresh request rather than forking around the cap.
      await expect(bridge.listMachines()).rejects.toThrow('gave up restarting');
      expect(fork).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a worker that answers something before each crash still exhausts the restart budget', async () => {
    vi.useFakeTimers();
    try {
      const bridge = new BeamNodeBridge();
      bridge.listMachines().catch(() => undefined);
      await settle();

      for (let i = 0; i < 10; i += 1) {
        // Every worker in this loop gets far enough to answer — a
        // machines push, a poll — and then dies. Speaking once is not
        // proof of health: a crash loop does exactly that on every
        // cycle, so a budget reset driven by a message alone is no
        // budget at all.
        child.emit('message', {
          kind: 'event',
          name: 'changed',
          payload: [localOnly()],
        });
        const dead = child;
        fork.mockReturnValue(makeChild());
        dead.emit('exit', 1);
        // Longer than any backoff step, shorter than the uptime a
        // worker has to survive to earn its retries back.
        await settle(10_000);
        child = fork.mock.results.at(-1)?.value as Child;
      }

      fork.mockClear();
      await expect(bridge.listMachines()).rejects.toThrow('gave up restarting');
      expect(fork).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('ordinary traffic in the dead-child window waits for the backoff instead of forking around it', async () => {
    vi.useFakeTimers();
    try {
      const bridge = new BeamNodeBridge();
      bridge.listMachines().catch(() => undefined);
      await settle();
      const replacement = makeChild();
      fork.mockReturnValue(replacement);
      child.emit('exit', 1);
      await settle();
      expect(fork).toHaveBeenCalledTimes(1);

      // `RemoteSessionPoller` fires a request a second, and every pty
      // op reaches `ensureChild` too — all of it lands well inside the
      // backoff window.
      const polled = bridge.listMachines();
      await settle(200);
      expect(fork).toHaveBeenCalledTimes(1);
      expect(replacement.postMessage).not.toHaveBeenCalled();

      // Once the backoff has elapsed the replacement forks, and the
      // call that was waiting on it goes to that worker.
      await settle(FIRST_RESTART_MS);
      expect(fork).toHaveBeenCalledTimes(2);
      const req = replacement.postMessage.mock.calls[0][0] as {
        id: number;
        op: string;
      };
      expect(req.op).toBe('listMachines');
      replacement.emit('message', {
        kind: 'response',
        id: req.id,
        ok: true,
        result: [localOnly()],
      });
      await expect(polled).resolves.toEqual([localOnly()]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a fork that throws while restarting is handled, not dropped', async () => {
    vi.useFakeTimers();
    try {
      const bridge = new BeamNodeBridge();
      bridge.listMachines().catch(() => undefined);
      await settle();
      child.emit('exit', 1);
      // Resource exhaustion after repeated restarts: `fork` throws
      // synchronously rather than handing back a process.
      fork.mockImplementation(() => {
        throw new Error('EAGAIN: unable to fork');
      });
      await settle(FIRST_RESTART_MS);

      // Handled, so nothing is left unhandled in main — and since the
      // restart could not produce a worker, the next caller is told
      // that instead of waiting on a child that will never exist.
      await expect(bridge.listMachines()).rejects.toThrow('gave up restarting');
    } finally {
      vi.useRealTimers();
    }
  });

  it('a worker that hangs without ever exiting fails its request and is killed', async () => {
    vi.useFakeTimers();
    try {
      const bridge = new BeamNodeBridge();
      // Collect the failure now rather than after advancing the
      // clock: an unhandled rejection is itself the bug next door.
      const failure = bridge.listMachines().catch((e: unknown) => e);
      await settle();
      expect(child.postMessage).toHaveBeenCalledTimes(1);

      // No answer and no exit: the worker is stuck in a loop, or on a
      // call to a machine that never settles. `'exit'` is the only
      // thing that drains `pending`, so without a timeout this call —
      // and every later one — waits for the life of the app.
      await settle(120_000);
      expect(String(await failure)).toContain('did not answer "listMachines"');
      expect(child.kill).toHaveBeenCalled();

      // Recovery is the ordinary restart path: the killed child
      // reports its exit and a replacement forks after the backoff.
      const replacement = makeChild();
      fork.mockReturnValue(replacement);
      child.emit('exit', null);
      await settle(FIRST_RESTART_MS);
      expect(fork).toHaveBeenCalledTimes(2);
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
    vi.useFakeTimers();
    try {
      const bridge = new BeamNodeBridge();

      // Generation 1: open a stream, worker calls it "pty-1".
      const firstOpen = bridge.ptyOpen('peer-1', { cols: 80, rows: 24 });
      await settle();
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
      await settle(FIRST_RESTART_MS);
      child = replacement;

      const secondOpen = bridge.ptyOpen('peer-1', { cols: 80, rows: 24 });
      await settle();
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
      await settle();
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
    } finally {
      vi.useRealTimers();
    }
  });

  it('a stale write that is itself what forks the replacement is dropped, not delivered to it', async () => {
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
    const staleHandle = await opening;

    // The worker dies; nothing has forked a replacement yet — the
    // restart is only scheduled. The cross-wire test above forces the
    // fork with a fresh `ptyOpen` first, which is exactly why it
    // cannot see this: here the stale write is the *first* thing to
    // reach `ensureChild` after the exit, so it forks the replacement
    // on its own way through `request()`.
    const replacement = makeChild();
    fork.mockReturnValue(replacement);
    child.emit('exit', 1);
    await tick();

    bridge.ptyWrite(staleHandle.streamId, 'oops');
    await tick();

    // Whether or not a replacement exists yet, a generation-1 raw id
    // must never be posted to one: `RemoteOps.nextStreamId` restarts
    // at 1 in the new process, so "pty-1" there is somebody else's
    // pane.
    expect(replacement.postMessage).not.toHaveBeenCalled();
  });

  it('a late message from an already-replaced worker keeps its own (dead) generation, never the live one (finding 4, second pass)', async () => {
    vi.useFakeTimers();
    try {
      const bridge = new BeamNodeBridge();

      // Generation 1: open a stream, worker calls it "pty-1".
      const firstOpen = bridge.ptyOpen('peer-1', { cols: 80, rows: 24 });
      await settle();
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
      const deadChild = child;

      // The worker dies and, once the backoff has elapsed, a
      // replacement forks and opens a stream of its own — so a message
      // from the dead child now arrives while a later generation is
      // live.
      const replacement = makeChild();
      fork.mockReturnValue(replacement);
      deadChild.emit('exit', 1);
      await settle(FIRST_RESTART_MS);
      child = replacement;
      const secondOpen = bridge.ptyOpen('peer-1', { cols: 80, rows: 24 });
      await settle();
      const secondReq = child.postMessage.mock.calls.find(
        (c) => (c[0] as { op: string }).op === 'ptyOpen'
      )?.[0] as { id: number };
      child.emit('message', {
        kind: 'response',
        id: secondReq.id,
        ok: true,
        result: { streamId: 'pty-1' },
      });
      await secondOpen;

      // A late 'pty-data' arrives on the dead child's own event emitter,
      // after generation 2 is already live — Electron delivering a
      // message after 'exit' is the scenario this guards, whether or
      // not it can really happen.
      const received: { kind: string; streamId: string; data?: string }[] = [];
      bridge.onPtyEvent((e) => received.push(e));
      deadChild.emit('message', {
        kind: 'event',
        name: 'pty-data',
        payload: { streamId: 'pty-1', data: 'late' },
      });

      // Must be labelled with the dead worker's own generation, never
      // the live one — reading `this.generation` at message time instead
      // of capturing it at fork time would wrap this under the
      // replacement's generation, indistinguishable from its own stream
      // of the same raw id.
      expect(received).toEqual([
        { kind: 'data', streamId: staleHandle.streamId, data: 'late' },
      ]);
    } finally {
      vi.useRealTimers();
    }
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

  it('forwards a mail-inbound event from the worker to every listener', async () => {
    const bridge = new BeamNodeBridge();
    bridge.listMachines().catch(() => undefined);
    await tick();
    const events: unknown[] = [];
    bridge.onInboundMail((e) => events.push(e));
    child.emit('message', {
      kind: 'event',
      name: 'mail-inbound',
      payload: { id: 'env-1', from: 'peer-1', fromLabel: 'workbox' },
    });
    expect(events).toEqual([
      { id: 'env-1', from: 'peer-1', fromLabel: 'workbox' },
    ]);
  });

  it('ackInboundMail sends the ackMail op with the envelope id', async () => {
    const bridge = new BeamNodeBridge();
    const acking = bridge.ackInboundMail('env-1');
    await tick();
    const req = child.postMessage.mock.calls.find(
      (c) => (c[0] as { op: string }).op === 'ackMail'
    )?.[0] as { id: number; payload: { id: string } };
    expect(req.payload).toEqual({ id: 'env-1' });
    child.emit('message', {
      kind: 'response',
      id: req.id,
      ok: true,
      result: true,
    });
    await acking;
  });
});
