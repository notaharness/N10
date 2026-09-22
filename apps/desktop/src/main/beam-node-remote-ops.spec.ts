/**
 * How `RemoteOps` decides which connection an op runs over.
 *
 * Two things it gets wrong if nothing pins them down. A reconnect that
 * reuses whatever is in the registry redials down the socket its last
 * stream died on — on a machine that vanished rather than closed, that
 * socket is still ESTABLISHED and still useless, so all three of the
 * backend's attempts, and the manual Reconnect after them, go the same
 * way. And a drop sets several callers dialing at once (the ~1s session
 * poller, the reconnect timer, a mail flush), where
 * `ConnectionRegistry.add` closes the loser of every race.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ConnectionRegistry,
  PeerTable,
  StreamRegistry,
  type Identity,
  type PeerConnection,
} from '@n10/beam';
import { RemoteOps } from './beam-node-remote-ops.js';

const PEER = 'aaaaaaaaaaaaaaaa';

let dir: string;
let peers: PeerTable;
let connections: ConnectionRegistry;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'beam-remote-ops-'));
  peers = new PeerTable(dir);
  peers.upsert({
    peerId: PEER,
    label: 'workbox',
    publicKeyPem: 'pem',
    endpoints: ['http://127.0.0.1:9'],
  });
  connections = new ConnectionRegistry();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function fakeConnection(alive: boolean): PeerConnection & {
  terminated: string[];
} {
  const terminated: string[] = [];
  return {
    peerId: PEER,
    terminated,
    openStream: vi.fn(),
    onStream: vi.fn(),
    onClose: vi.fn(),
    close: vi.fn(),
    terminate: (reason?: string) => terminated.push(reason ?? ''),
    checkAlive: () => Promise.resolve(alive),
  };
}

/** A connection whose liveness answer the test decides, and decides
 *  *when* — the window `connectionFor` is awaiting in is the whole
 *  subject of the tests below. */
function probedConnection(): PeerConnection & {
  terminated: string[];
  answer: (alive: boolean) => void;
  asked: () => boolean;
} {
  const terminated: string[] = [];
  let settle: (alive: boolean) => void = () => undefined;
  let asked = false;
  const pending = new Promise<boolean>((resolve) => {
    settle = resolve;
  });
  return {
    peerId: PEER,
    terminated,
    openStream: vi.fn(),
    onStream: vi.fn(),
    onClose: vi.fn(),
    close: vi.fn(),
    terminate: (reason?: string) => terminated.push(reason ?? ''),
    checkAlive: () => {
      asked = true;
      return pending;
    },
    answer: (alive: boolean) => settle(alive),
    asked: () => asked,
  };
}

/** Let a pending `connectionFor` run through its post-probe registry
 *  read without advancing any timer. */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

type RemoteOpsDial = NonNullable<
  ConstructorParameters<typeof RemoteOps>[0]['dial']
>;

/** A dial that registers a fresh connection, counting calls and
 *  resolving only when the test says so. */
function stubDial(): {
  dial: RemoteOpsDial;
  calls: string[];
  release: () => void;
} {
  const calls: string[] = [];
  let open: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  const dial: RemoteOpsDial = async (endpoint, _peerId, options) => {
    calls.push(endpoint);
    await gate;
    const fresh = fakeConnection(true);
    options.connections?.add(fresh);
    return fresh;
  };
  return { dial, calls, release: () => open() };
}

function opsWith(dial: RemoteOpsDial): RemoteOps {
  return new RemoteOps({
    getIdentity: () => ({ peerId: 'local' } as Identity),
    peers,
    connections,
    registry: new StreamRegistry(),
    dial,
  });
}

describe('RemoteOps.connectionFor', () => {
  it('dials once for callers that race each other, and hands both the same connection', async () => {
    const { dial, calls, release } = stubDial();
    const ops = opsWith(dial);

    const first = ops.connectionFor(PEER);
    const second = ops.connectionFor(PEER);
    release();
    const [a, b] = await Promise.all([first, second]);

    expect(calls).toHaveLength(1);
    expect(a).toBe(b);
    expect(connections.get(PEER)).toBe(a);
  });

  it('dials again once an earlier dial has finished', async () => {
    const first = stubDial();
    const ops = opsWith(first.dial);
    first.release();
    await ops.connectionFor(PEER);
    // A second op on a peer that is now connected reuses it rather than
    // holding on to the finished dial.
    const reused = await ops.connectionFor(PEER);
    expect(first.calls).toHaveLength(1);
    expect(reused).toBe(connections.get(PEER));
  });

  it('reuses a connection that answers, even on a reconnect', async () => {
    const live = fakeConnection(true);
    connections.add(live);
    const { dial, calls } = stubDial();

    const used = await opsWith(dial).connectionFor(PEER, { reconnect: true });

    // A pty stream can end for its own reasons, and this connection is
    // shared with every other pane on that machine and with the mailbox.
    expect(used).toBe(live);
    expect(live.terminated).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('terminates a connection that does not answer, then dials a new one', async () => {
    const zombie = fakeConnection(false);
    connections.add(zombie);
    const { dial, calls, release } = stubDial();
    const ops = opsWith(dial);

    const pending = ops.connectionFor(PEER, { reconnect: true });
    release();
    const used = await pending;

    expect(zombie.terminated).toEqual(['no answer before a reconnect']);
    expect(calls).toHaveLength(1);
    expect(used).not.toBe(zombie);
    expect(connections.get(PEER)).toBe(used);
  });

  it('uses the connection the registry holds now, not the one it held before the probe', async () => {
    // The probe takes seconds, and the peer can arrive inside them: its
    // own reconnect and mail-dial paths dial us, and
    // `ConnectionRegistry.add` closes what it supersedes — which
    // resolves the probe on the old connection with `false`. Acting on
    // that answer terminates a connection that is already gone and
    // dials a third, and `add` closes the fresh second one, reaping the
    // streams panes had just reopened on it.
    const superseded = probedConnection();
    connections.add(superseded);
    const { dial, calls } = stubDial();
    const ops = opsWith(dial);

    const pending = ops.connectionFor(PEER, { reconnect: true });
    await flush();
    expect(superseded.asked()).toBe(true);

    const fresh = fakeConnection(true);
    connections.add(fresh);
    superseded.answer(false);

    expect(await pending).toBe(fresh);
    expect(calls).toEqual([]);
    expect(superseded.terminated).toEqual([]);
    expect(connections.get(PEER)).toBe(fresh);
  });

  it('dials when the connection it was probing went away and nothing replaced it', async () => {
    // The other side of the same read: gone is gone, and there is
    // nothing to terminate.
    const departing = probedConnection();
    connections.add(departing);
    const { dial, calls, release } = stubDial();
    const ops = opsWith(dial);

    const pending = ops.connectionFor(PEER, { reconnect: true });
    await flush();
    connections.add(fakeConnection(true));
    // Whatever the registry now holds is not what was probed; emptying
    // it leaves this reconnect with nothing to reuse.
    (
      connections as unknown as { connections: Map<string, unknown> }
    ).connections.delete(PEER);
    departing.answer(false);
    release();

    await pending;
    expect(calls).toHaveLength(1);
    expect(departing.terminated).toEqual([]);
  });

  it('leaves a connection that does not answer alone when the caller is not reconnecting', async () => {
    const zombie = fakeConnection(false);
    connections.add(zombie);
    const { dial, calls } = stubDial();

    const used = await opsWith(dial).connectionFor(PEER);

    expect(used).toBe(zombie);
    expect(zombie.terminated).toEqual([]);
    expect(calls).toEqual([]);
  });
});
