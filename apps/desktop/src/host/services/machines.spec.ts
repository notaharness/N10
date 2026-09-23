import { beforeEach, describe, expect, it } from 'vitest';
import type { MachineView } from '../contract-machines.js';
import {
  getLastKnownMachines,
  listMachines,
  receiveMachinesUpdate,
  renameMachine,
  revokeMachine,
  setMachinesNotifier,
  setMachinesPort,
  type MachinesPort,
} from './machines.js';

/**
 * The main-process façade over the machines transport, tested against a
 * fake port — no Electron, no real transport.
 */

function localMachine(): MachineView {
  return {
    peerId: 'aaaaaaaaaaaaaaaa',
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
    renameMachine: record('renameMachine', (peerId: string, label: string) =>
      Promise.resolve({ ...localMachine(), peerId, label })
    ),
    revokeMachine: record('revokeMachine', (peerId: string) =>
      Promise.resolve({ ...localMachine(), peerId, state: 'revoked' as const })
    ),
  };
}

beforeEach(() => {
  setMachinesPort(null);
  setMachinesNotifier(null);
});

describe('without a port installed', () => {
  it('every call rejects with a clear reason instead of hanging', async () => {
    await expect(listMachines()).rejects.toThrow(/not available/);
    await expect(revokeMachine('b')).rejects.toThrow(/not available/);
  });
});

describe('with a port installed', () => {
  it('forwards every call to the port, arguments untouched, and returns its answer', async () => {
    const port = fakePort();
    setMachinesPort(port);

    await expect(listMachines()).resolves.toEqual([localMachine()]);
    await renameMachine('bbbbbbbbbbbbbbbb', 'workbox-2');
    await revokeMachine('bbbbbbbbbbbbbbbb');

    expect(port.calls).toEqual([
      ['listMachines', []],
      ['renameMachine', ['bbbbbbbbbbbbbbbb', 'workbox-2']],
      ['revokeMachine', ['bbbbbbbbbbbbbbbb']],
    ]);
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
    const port = fakePort();
    setMachinesPort(port);
    await listMachines();
    expect(getLastKnownMachines()).toEqual([localMachine()]);
  });
});
