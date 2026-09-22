import { beforeEach, describe, expect, it } from 'vitest';
import type { MachineView } from '../contract-machines.js';
import {
  confirmPairing,
  forgetMachine,
  getAcceptingStatus,
  getLastKnownMachines,
  listMachines,
  previewPairing,
  receiveMachinesUpdate,
  regeneratePairingUrl,
  renameMachine,
  revokeMachine,
  setAccepting,
  setMachinesNotifier,
  setMachinesPort,
  type MachinesPort,
} from './machines.js';

/**
 * The main-process façade over the beam node's utility-process bridge.
 * Tested against a fake port, exactly the way `desktop-prefs.ts` and
 * friends are tested with a fake filesystem — no Electron, no real
 * worker.
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
    getAcceptingStatus: record('getAcceptingStatus', () =>
      Promise.resolve({
        accepting: false,
        boundAddress: null,
        pairingUrl: null,
        pairingExpiresAt: null,
        connectedCount: 0,
      })
    ),
    setAccepting: record('setAccepting', (enabled: boolean) =>
      Promise.resolve({
        accepting: enabled,
        boundAddress: enabled ? '127.0.0.1:1234' : null,
        pairingUrl: null,
        pairingExpiresAt: null,
        connectedCount: 0,
      })
    ),
    regeneratePairingUrl: record('regeneratePairingUrl', () =>
      Promise.resolve({
        accepting: true,
        boundAddress: '127.0.0.1:1234',
        pairingUrl: 'http://x/pair#token=y',
        pairingExpiresAt: 123,
        connectedCount: 0,
      })
    ),
    previewPairing: record('previewPairing', (url: string) =>
      Promise.resolve({
        ok: true as const,
        preview: {
          label: 'workbox',
          peerId: 'bbbbbbbbbbbbbbbb',
          endpoint: url,
        },
      })
    ),
    confirmPairing: record('confirmPairing', () =>
      Promise.resolve({
        ok: true as const,
        machine: {
          ...localMachine(),
          isLocal: false,
          peerId: 'bbbbbbbbbbbbbbbb',
        },
      })
    ),
    renameMachine: record('renameMachine', (peerId: string, label: string) =>
      Promise.resolve({ ...localMachine(), peerId, label })
    ),
    revokeMachine: record('revokeMachine', (peerId: string) =>
      Promise.resolve({ ...localMachine(), peerId, state: 'revoked' as const })
    ),
    forgetMachine: record('forgetMachine', () => Promise.resolve()),
  };
}

beforeEach(() => {
  setMachinesPort(null);
  setMachinesNotifier(null);
});

describe('without a port installed', () => {
  it('every call rejects with a clear reason instead of hanging', async () => {
    await expect(listMachines()).rejects.toThrow(/beam node is not available/);
    await expect(getAcceptingStatus()).rejects.toThrow(/not available/);
  });
});

describe('with a port installed', () => {
  it('forwards every call to the port, arguments untouched, and returns its answer', async () => {
    const port = fakePort();
    setMachinesPort(port);

    await expect(listMachines()).resolves.toEqual([localMachine()]);
    await getAcceptingStatus();
    await setAccepting(true);
    await regeneratePairingUrl();
    await previewPairing('http://x/pair#token=y');
    await confirmPairing('http://x/pair#token=y', true);
    await renameMachine('bbbbbbbbbbbbbbbb', 'workbox-2');
    await revokeMachine('bbbbbbbbbbbbbbbb');
    await forgetMachine('bbbbbbbbbbbbbbbb');

    expect(port.calls).toEqual([
      ['listMachines', []],
      ['getAcceptingStatus', []],
      ['setAccepting', [true]],
      ['regeneratePairingUrl', []],
      ['previewPairing', ['http://x/pair#token=y']],
      ['confirmPairing', ['http://x/pair#token=y', true]],
      ['renameMachine', ['bbbbbbbbbbbbbbbb', 'workbox-2']],
      ['revokeMachine', ['bbbbbbbbbbbbbbbb']],
      ['forgetMachine', ['bbbbbbbbbbbbbbbb']],
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
