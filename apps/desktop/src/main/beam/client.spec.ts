import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BeamStatus, MachineView } from '../../host/contract-machines.js';
import { setInboundMailPort } from '../../host/services/inbound-mail.js';
import {
  cancelCeremony,
  listMachines,
  setBeamStatusNotifier,
  setMachineGrant,
  setMachinesNotifier,
  setMachinesPort,
} from '../../host/services/machines.js';
import { setRemoteMachinePort } from '../../host/services/remote-machines.js';
import { BeamClient } from './client.js';
import type { PeerView } from './peers.js';
import { FakeDaemon } from './test-support/fake-daemon.js';
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
    revokedAt: null,
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
  client?.stop();
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
    daemon = await FakeDaemon.start(socketPath);
    enrolledDaemon(daemon, []);
    await until(() => last(statuses)?.state === 'ready');
    expect(daemon.requests('events.subscribe')).toHaveLength(1);
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
