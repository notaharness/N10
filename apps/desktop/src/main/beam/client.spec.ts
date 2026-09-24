import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  BeamStatus,
  DirectoryPublished,
  MachineView,
} from '../../host/contract-machines.js';
import { setInboundMailPort } from '../../host/services/inbound-mail.js';
import {
  cancelCeremony,
  setDirectoryPublishedNotifier,
  resetFleet,
  runCeremony,
  listMachines,
  setBeamStatusNotifier,
  setMachineGrant,
  setMachinesNotifier,
  setMachinesPort,
} from '../../host/services/machines.js';
import { setRemoteMachinePort } from '../../host/services/remote-machines.js';
import { BeamClient } from './client.js';
import type { DaemonExit, OwnedDaemon } from './owned-daemon.js';
import type { PeerView } from './peers.js';
import { FakeDaemon, FakeOpError } from './test-support/fake-daemon.js';
import { until } from './test-support/until.js';

const SELF = 'a'.repeat(32);

function peer(id: string, label: string, state = 'connected'): PeerView {
  return {
    peerId: id,
    label,
    alias: null,
    state,
    path: 'direct',
    lastSeenAt: 1000,
    grant: 'all',
    queue: { outbound: 0 },
  };
}

let dir: string;
let socketPath: string;
let daemon: FakeDaemon | null;
let client: BeamClient | null;
let statuses: BeamStatus[];
let pushed: MachineView[][];

function enrolledDaemon(d: FakeDaemon, peers: PeerView[]): void {
  d.on('status', () => ({
    ready: true,
    enrolled: true,
    peerId: SELF,
    label: 'laptop',
    fleetId: 'f'.repeat(64),
  }));
  d.on('peers', (req) =>
    req.cursor
      ? { peers: peers.slice(1) }
      : { peers: peers.slice(0, 1), next: peers[0]?.peerId }
  );
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'n10-beam-client-'));
  socketPath = join(dir, 'beam.sock');
  daemon = null;
  client = null;
  statuses = [];
  pushed = [];
  setBeamStatusNotifier((s) => statuses.push(s));
  setMachinesNotifier((m) => pushed.push(m));
});

afterEach(async () => {
  await client?.shutdown();
  await daemon?.close();
  rmSync(dir, { recursive: true, force: true });
  setMachinesPort(null);
  setRemoteMachinePort(null);
  setInboundMailPort(null);
  setBeamStatusNotifier(null);
  setMachinesNotifier(null);
});

const last = <T>(xs: T[]) => xs[xs.length - 1];

describe('BeamClient', () => {
  it('says beam is not running, then connects once a daemon appears', async () => {
    client = new BeamClient({ socketPath });
    client.start();
    await until(() => last(statuses)?.state === 'unavailable');
    expect(last(statuses).detail).toMatch(/not running/);

    daemon = await FakeDaemon.start(socketPath);
    daemon.on('status', () => ({ ready: true, enrolled: false }));
    await until(() => last(statuses)?.state === 'ready');
    expect(last(statuses)).toEqual({
      state: 'ready',
      detail: null,
      enrolled: false,
      fleetId: null,
    });
    expect(daemon.requests('events.subscribe')).toHaveLength(1);
    await expect(listMachines()).resolves.toEqual([]);
  });

  it('lists this machine first, then every page of peers by label', async () => {
    daemon = await FakeDaemon.start(socketPath);
    enrolledDaemon(daemon, [
      peer('c'.repeat(32), 'zeta'),
      peer('b'.repeat(32), 'alpha', 'offline'),
    ]);
    client = new BeamClient({ socketPath });
    client.start();
    await until(() => pushed.length > 0);
    expect(last(pushed).map((m) => [m.label, m.isLocal, m.state])).toEqual([
      ['laptop', true, 'connected'],
      ['alpha', false, 'offline'],
      ['zeta', false, 'connected'],
    ]);
    expect(daemon.requests('peers')[1]).toMatchObject({
      cursor: 'c'.repeat(32),
    });
  });

  it('merges peer and peer.new events into the pushed list', async () => {
    daemon = await FakeDaemon.start(socketPath);
    enrolledDaemon(daemon, [peer('c'.repeat(32), 'zeta')]);
    client = new BeamClient({ socketPath });
    client.start();
    await until(() => pushed.length > 0);
    daemon.emit('peer', { ...peer('c'.repeat(32), 'zeta'), alias: 'build' });
    daemon.emit('peer.new', peer('d'.repeat(32), 'beta'));
    await until(() => last(pushed).length === 3);
    expect(last(pushed).map((m) => m.label)).toEqual([
      'laptop',
      'beta',
      'build',
    ]);
  });

  it('subscribes the mail relay once the daemon is enrolled', async () => {
    daemon = await FakeDaemon.start(socketPath);
    enrolledDaemon(daemon, []);
    client = new BeamClient({ socketPath });
    client.start();
    await until(() => daemon!.requests('msg.subscribe').length === 1);
    expect(daemon.requests('msg.subscribe')[0]).toMatchObject({
      topic: 'orchestra',
    });
  });

  it('shows beam restarting after an unexpected loss, and reconnects', async () => {
    daemon = await FakeDaemon.start(socketPath);
    enrolledDaemon(daemon, []);
    client = new BeamClient({ socketPath });
    client.start();
    await until(() => last(statuses)?.state === 'ready');
    await daemon.close();
    await until(() => last(statuses)?.state === 'restarting');
    const lostAt = statuses.length;
    daemon = await FakeDaemon.start(socketPath);
    enrolledDaemon(daemon, []);
    await until(() => last(statuses)?.state === 'ready');
    expect(daemon.requests('events.subscribe')).toHaveLength(1);
    // The list stays up under Reconnecting, not behind a loading state.
    expect(statuses.slice(lostAt).map((s) => s.state)).not.toContain(
      'starting'
    );
  });

  it('sends a grant change to the daemon', async () => {
    daemon = await FakeDaemon.start(socketPath);
    enrolledDaemon(daemon, []);
    client = new BeamClient({ socketPath });
    client.start();
    await until(() => last(statuses)?.state === 'ready');
    await setMachineGrant('c'.repeat(32), 'msg');
    expect(daemon.requests('peer.grant')[0]).toMatchObject({
      peer: 'c'.repeat(32),
      grant: 'msg',
    });
  });

  it('refuses a list while disconnected rather than answering none', async () => {
    client = new BeamClient({ socketPath });
    client.start();
    await until(() => last(statuses)?.state === 'unavailable');
    await expect(listMachines()).rejects.toThrow(/not connected/);
  });

  it('applies a peer event that overtakes the list it belongs after', async () => {
    daemon = await FakeDaemon.start(socketPath);
    enrolledDaemon(daemon, []);
    daemon.on('peers', (_req, conn) => {
      conn.emit('peer', { ...peer('c'.repeat(32), 'zeta'), alias: 'build' });
      return { peers: [peer('c'.repeat(32), 'zeta')] };
    });
    client = new BeamClient({ socketPath });
    client.start();
    await until(() => pushed.length > 0);
    expect(last(pushed).map((m) => m.label)).toEqual(['laptop', 'build']);
  });

  it('re-lists when a peer appears while unenrolled: enrolled from the CLI', async () => {
    daemon = await FakeDaemon.start(socketPath);
    daemon.on('status', () => ({ ready: true, enrolled: false }));
    client = new BeamClient({ socketPath });
    client.start();
    await until(() => last(statuses)?.state === 'ready');
    enrolledDaemon(daemon, [peer('c'.repeat(32), 'zeta')]);
    daemon.emit('peer.new', peer('c'.repeat(32), 'zeta'));
    await until(() => last(statuses)?.enrolled === true);
    await until(() => last(pushed)?.length === 2);
    expect(last(pushed)[0]).toMatchObject({ label: 'laptop', isLocal: true });
  });

  it('subscribes the relay again under a new enrolment', async () => {
    daemon = await FakeDaemon.start(socketPath);
    enrolledDaemon(daemon, []);
    client = new BeamClient({ socketPath });
    client.start();
    await until(() => daemon!.requests('msg.subscribe').length === 1);
    daemon.on('status', () => ({
      ready: true,
      enrolled: true,
      peerId: SELF,
      label: 'laptop',
      fleetId: 'e'.repeat(64),
    }));
    await listMachines();
    await until(() => daemon!.requests('msg.subscribe').length === 2);
    const relays = daemon.controls.filter((c) =>
      c.requests.some((r) => r.op === 'msg.subscribe')
    );
    expect(relays).toHaveLength(2);
    await until(() => relays[0].socket.destroyed);
  });

  it('re-reads status after a failed ceremony: beam may have committed first', async () => {
    daemon = await FakeDaemon.start(socketPath);
    daemon.on('status', () => ({ ready: true, enrolled: false }));
    daemon.on('join.start', () => ({ ceremonyUrl: 'https://beam.n10.is/#j' }));
    daemon.on('join.wait', () => {
      enrolledDaemon(daemon!, []);
      throw new FakeOpError('directory-unavailable');
    });
    client = new BeamClient({ socketPath });
    client.start();
    await until(() => last(statuses)?.state === 'ready');
    await expect(runCeremony({ op: 'join', label: '' })).resolves.toMatchObject(
      { ok: false, code: 'directory-unavailable' }
    );
    await until(() => last(statuses)?.enrolled === true);
  });

  it('resets this machine’s fleet through beam, then re-reads status', async () => {
    daemon = await FakeDaemon.start(socketPath);
    enrolledDaemon(daemon, []);
    daemon.on('fleet.reset', () => {
      daemon!.on('status', () => ({ ready: true, enrolled: false }));
      return {};
    });
    client = new BeamClient({ socketPath });
    client.start();
    await until(() => last(statuses)?.enrolled === true);
    await expect(resetFleet()).resolves.toEqual({ ok: true });
    expect(daemon.requests('fleet.reset')[0]).toMatchObject({
      confirm: 'reset',
    });
    await until(() => last(statuses)?.enrolled === false);
  });

  it('names a reset whose connection dropped as lost: it may have happened', async () => {
    daemon = await FakeDaemon.start(socketPath);
    enrolledDaemon(daemon, []);
    daemon.on('fleet.reset', () => {
      for (const c of daemon!.controls) c.destroy();
      return new Promise(() => undefined);
    });
    client = new BeamClient({ socketPath });
    client.start();
    await until(() => last(statuses)?.state === 'ready');
    await expect(resetFleet()).resolves.toEqual({
      ok: false,
      code: 'connection-lost',
      detail: null,
    });
  });

  it('resolves a refused reset with beam’s code and detail', async () => {
    daemon = await FakeDaemon.start(socketPath);
    enrolledDaemon(daemon, []);
    daemon.on('fleet.reset', () => {
      throw new FakeOpError('storage-failure', 'disk full');
    });
    client = new BeamClient({ socketPath });
    client.start();
    await until(() => last(statuses)?.state === 'ready');
    await expect(resetFleet()).resolves.toEqual({
      ok: false,
      code: 'storage-failure',
      detail: 'disk full',
    });
  });

  it('reads the fleet this machine belongs to from status', async () => {
    daemon = await FakeDaemon.start(socketPath);
    enrolledDaemon(daemon, []);
    client = new BeamClient({ socketPath });
    client.start();
    await until(() => last(statuses)?.enrolled === true);
    expect(last(statuses).fleetId).toBe('f'.repeat(64));
  });

  it('says beam is starting while its socket answers and its transport does not', async () => {
    const d = (daemon = await FakeDaemon.start(socketPath));
    d.on('status', () => ({ enrolled: false }));
    let started: (v: unknown) => void = () => undefined;
    d.on('events.subscribe', () => new Promise((r) => (started = r)));
    client = new BeamClient({ socketPath });
    client.start();
    await until(() => last(statuses)?.state === 'starting');
    await until(() => d.requests('events.subscribe').length === 1);
    started({});
    await until(() => last(statuses)?.state === 'ready');
    expect(statuses.map((s) => s.state).slice(-2)).toEqual([
      'starting',
      'ready',
    ]);
  });

  it('passes on a directory write that landed', async () => {
    const landed: DirectoryPublished[] = [];
    setDirectoryPublishedNotifier((p) => landed.push(p));
    daemon = await FakeDaemon.start(socketPath);
    enrolledDaemon(daemon, []);
    client = new BeamClient({ socketPath });
    client.start();
    await until(() => last(statuses)?.enrolled === true);
    daemon.emit('directory.published', { kind: 'member', peerId: SELF });
    await until(() => landed.length === 1);
    expect(landed[0]).toEqual({ kind: 'member', peerId: SELF });
    setDirectoryPublishedNotifier(null);
  });

  it('subscribes the relay again when beam re-enrols into the same fleet', async () => {
    daemon = await FakeDaemon.start(socketPath);
    const status = (generation: number) => () => ({
      ready: true,
      enrolled: true,
      peerId: SELF,
      label: 'laptop',
      fleetId: 'f'.repeat(64),
      generation,
    });
    daemon.on('status', status(1));
    daemon.on('peers', () => ({ peers: [] }));
    client = new BeamClient({ socketPath });
    client.start();
    await until(() => daemon!.requests('msg.subscribe').length === 1);
    daemon.on('status', status(3));
    await listMachines();
    await until(() => daemon!.requests('msg.subscribe').length === 2);
    const relays = daemon.controls.filter((c) =>
      c.requests.some((r) => r.op === 'msg.subscribe')
    );
    expect(relays).toHaveLength(2);
  });

  it('cancels only a ceremony of its own', async () => {
    daemon = await FakeDaemon.start(socketPath);
    enrolledDaemon(daemon, []);
    client = new BeamClient({ socketPath });
    client.start();
    await until(() => last(statuses)?.state === 'ready');
    await cancelCeremony();
    await listMachines();
    expect(daemon.requests('ceremony.cancel')).toHaveLength(0);
  });
});

/** A `spawnDaemon` whose daemon is a FakeDaemon at the client's socket.
 *  It exits shortly after it is asked to stop. */
function fakeSpawner(options: { startsAfterMs?: number } = {}) {
  const spawned: { stopped: boolean; killed: boolean; exit(): void }[] = [];
  const spawn = (): OwnedDaemon => {
    let exit!: (how: DaemonExit) => void;
    const exited = new Promise<DaemonExit>((resolve) => (exit = resolve));
    const started = delay(options.startsAfterMs ?? 0)
      .then(() => FakeDaemon.start(socketPath))
      .then((d) => {
        daemon = d;
        d.on('status', () => ({ ready: true, enrolled: false }));
        return d;
      });
    const stopIt = async () => {
      await (await started).close();
      exit({ code: 0, signal: null });
    };
    const entry = {
      stopped: false,
      killed: false,
      exit: () => void stopIt(),
    };
    spawned.push(entry);
    return {
      exited,
      stop: () => {
        entry.stopped = true;
        setTimeout(() => void stopIt(), 10);
      },
      kill: () => {
        entry.killed = true;
        void stopIt();
      },
    };
  };
  return { spawn, spawned };
}

describe('BeamClient owning the daemon', () => {
  it('starts a daemon when none answers, and stops it on shutdown', async () => {
    const { spawn, spawned } = fakeSpawner();
    client = new BeamClient({ socketPath, spawnDaemon: spawn });
    client.start();
    await until(() => last(statuses)?.state === 'ready');
    expect(spawned).toHaveLength(1);
    const owned = daemon!;

    await client.shutdown();
    client = null;
    expect(spawned[0].stopped).toBe(true);
    expect(owned.requests('daemon.shutdown')).toHaveLength(0);
    expect(spawned[0].killed).toBe(false);
  });

  it('uses a daemon already running and leaves it running', async () => {
    daemon = await FakeDaemon.start(socketPath);
    daemon.on('status', () => ({ ready: true, enrolled: false }));
    const { spawn, spawned } = fakeSpawner();
    client = new BeamClient({ socketPath, spawnDaemon: spawn });
    client.start();
    await until(() => last(statuses)?.state === 'ready');
    await client.shutdown();
    client = null;
    expect(spawned).toHaveLength(0);
    expect(daemon.requests('daemon.shutdown')).toHaveLength(0);
  });

  it('starts another daemon after its own one dies', async () => {
    const { spawn, spawned } = fakeSpawner();
    client = new BeamClient({ socketPath, spawnDaemon: spawn });
    client.start();
    await until(() => last(statuses)?.state === 'ready');
    spawned[0].exit();
    await until(() => last(statuses)?.state === 'restarting');
    await until(() => last(statuses)?.state === 'ready');
    expect(spawned).toHaveLength(2);
  });

  it('stops a daemon still starting at shutdown, and starts no other', async () => {
    const { spawn, spawned } = fakeSpawner({ startsAfterMs: 200 });
    client = new BeamClient({ socketPath, spawnDaemon: spawn });
    client.start();
    await until(() => spawned.length === 1);
    await client.shutdown();
    client = null;
    // Past the first reconnect (500 ms), which would spawn again.
    await delay(800);
    expect(spawned).toHaveLength(1);
    expect(spawned[0].stopped).toBe(true);
  });

  it('says how a daemon it started ended before answering', async () => {
    const spawn = (): OwnedDaemon => ({
      exited: Promise.resolve({
        code: null,
        signal: null,
        error: 'spawn beam ENOENT',
      }),
      stop: () => undefined,
      kill: () => undefined,
    });
    client = new BeamClient({ socketPath, spawnDaemon: spawn });
    client.start();
    await until(() => last(statuses)?.state === 'unavailable');
    expect(last(statuses).detail).toBe(
      'beam could not start: the daemon could not run: spawn beam ENOENT'
    );
  });

  it('uses the daemon that won the start race, and leaves it running', async () => {
    const spawn = (): OwnedDaemon => {
      setTimeout(() => {
        void FakeDaemon.start(socketPath).then((d) => {
          daemon = d;
          d.on('status', () => ({ ready: true, enrolled: false }));
        });
      }, 150);
      return {
        exited: Promise.resolve({
          code: 1,
          signal: null,
          lastLine: 'beam: another daemon holds $BEAM_DIR',
        }),
        stop: () => undefined,
        kill: () => undefined,
      };
    };
    client = new BeamClient({ socketPath, spawnDaemon: spawn });
    client.start();
    await until(() => last(statuses)?.state === 'ready');
    expect(statuses.map((s) => s.state)).not.toContain('unavailable');
    await client.shutdown();
    client = null;
    expect(daemon!.requests('daemon.shutdown')).toHaveLength(0);
  });

  it('says a daemon it started never answered', async () => {
    const spawn = (): OwnedDaemon => {
      let exit!: (e: DaemonExit) => void;
      return {
        exited: new Promise<DaemonExit>((resolve) => (exit = resolve)),
        stop: () => exit({ code: 0, signal: null }),
        kill: () => undefined,
      };
    };
    client = new BeamClient({ socketPath, spawnDaemon: spawn });
    client.start();
    await until(() => last(statuses)?.state === 'unavailable', 8000);
    expect(last(statuses).detail).toMatch(/^beam could not start/);
  }, 10_000);
});
