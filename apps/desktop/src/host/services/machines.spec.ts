import { beforeEach, describe, expect, it } from 'vitest';
import type {
  BeamStatus,
  CeremonyProgress,
  MachineView,
} from '../contract-machines.js';
import {
  cancelCeremony,
  getBeamStatus,
  getLastKnownMachines,
  listMachines,
  receiveBeamStatus,
  receiveMachinesUpdate,
  runCeremony,
  setBeamStatusNotifier,
  setCeremonyProgressNotifier,
  setMachineAlias,
  setMachineGrant,
  setMachinesNotifier,
  setMachinesPort,
  type MachinesPort,
} from './machines.js';

/**
 * The main-process façade over the machines transport, tested against a
 * fake port — no Electron, no real transport.
 */

const PEER = 'b'.repeat(32);

function localMachine(): MachineView {
  return {
    peerId: 'a'.repeat(32),
    label: 'my-mac',
    isLocal: true,
    state: 'connected',
    path: null,
    lastSeenAt: null,
    grant: 'all',
    queued: 0,
    inboundWaiting: [],
    inboundRefused: [],
  };
}

const PROGRESS: CeremonyProgress = { kind: 'stage', stage: 'publishing' };

function fakePort(): MachinesPort & { calls: [string, unknown[]][] } {
  const calls: [string, unknown[]][] = [];
  const record =
    <A extends unknown[], R>(name: string, impl: (...args: A) => R) =>
    (...args: A): R => {
      calls.push([name, args]);
      return impl(...args);
    };
  return {
    calls,
    listMachines: record('listMachines', () =>
      Promise.resolve([localMachine()])
    ),
    setAlias: record('setAlias', () => Promise.resolve()),
    setGrant: record('setGrant', () => Promise.resolve()),
    runCeremony: (request, onProgress) => {
      calls.push(['runCeremony', [request]]);
      onProgress(PROGRESS);
      return Promise.resolve({
        ok: true as const,
        op: 'revoke' as const,
        published: true,
        acknowledgedBy: 1,
      });
    },
    cancelCeremony: record('cancelCeremony', () => Promise.resolve()),
  };
}

beforeEach(() => {
  setMachinesPort(null);
  setMachinesNotifier(null);
  setBeamStatusNotifier(null);
  setCeremonyProgressNotifier(null);
});

describe('without a port installed', () => {
  it('every call rejects with a clear reason instead of hanging', async () => {
    await expect(listMachines()).rejects.toThrow(/not available/);
    await expect(setMachineGrant(PEER, 'none')).rejects.toThrow(
      /not available/
    );
  });
});

describe('with a port installed', () => {
  it('forwards every call to the port, arguments untouched', async () => {
    const port = fakePort();
    setMachinesPort(port);

    await expect(listMachines()).resolves.toEqual([localMachine()]);
    await setMachineAlias(PEER, 'workbox');
    await setMachineAlias(PEER, null);
    await setMachineGrant(PEER, 'msg');
    await runCeremony({ op: 'revoke', peerId: PEER });
    await cancelCeremony();

    expect(port.calls).toEqual([
      ['listMachines', []],
      ['setAlias', [PEER, 'workbox']],
      ['setAlias', [PEER, null]],
      ['setGrant', [PEER, 'msg']],
      ['runCeremony', [{ op: 'revoke', peerId: PEER }]],
      ['cancelCeremony', []],
    ]);
  });

  it('pushes a running ceremony’s progress and resolves with its outcome', async () => {
    setMachinesPort(fakePort());
    const seen: CeremonyProgress[] = [];
    setCeremonyProgressNotifier((p) => seen.push(p));
    await expect(
      runCeremony({ op: 'revoke', peerId: PEER })
    ).resolves.toMatchObject({ ok: true, op: 'revoke' });
    expect(seen).toEqual([PROGRESS]);
  });
});

describe('the push channel', () => {
  it('calls the installed notifier with exactly what it receives', () => {
    const seen: MachineView[][] = [];
    setMachinesNotifier((machines) => seen.push(machines));
    receiveMachinesUpdate([localMachine()]);
    expect(seen).toEqual([[localMachine()]]);
  });

  it('caches the last update for getLastKnownMachines, with no notifier required', () => {
    receiveMachinesUpdate([localMachine()]);
    expect(getLastKnownMachines()).toEqual([localMachine()]);
  });

  it('listMachines() also refreshes the cache, for a caller that only reads', async () => {
    setMachinesPort(fakePort());
    await listMachines();
    expect(getLastKnownMachines()).toEqual([localMachine()]);
  });

  it('pushes and answers the latest beam status', async () => {
    const ready: BeamStatus = {
      state: 'ready',
      detail: null,
      enrolled: true,
    };
    const seen: BeamStatus[] = [];
    setBeamStatusNotifier((s) => seen.push(s));
    receiveBeamStatus(ready);
    expect(seen).toEqual([ready]);
    await expect(getBeamStatus()).resolves.toEqual(ready);
  });
});
