import { beforeAll, describe, expect, it, vi } from 'vitest';
import { IPC, type N10HostApi } from '../host/contract.js';

/**
 * The bridge is a three-way agreement between contract.ts (the channel
 * names and the API shape), preload.ts (the renderer's side) and
 * register-handlers.ts (the main process's side). TypeScript checks the
 * *shape*, but nothing checks the wiring: a method may invoke the wrong
 * channel and still compile, and the failure only shows up at runtime
 * as a hung promise or a wrong answer.
 *
 * register-handlers.spec.ts covers the main-process half. This covers
 * the renderer half, plus the round trip: for every channel in the
 * contract, exactly one bridge method invokes it — and it is the method
 * of the same name.
 */

const invoked: { channel: string; args: unknown[] }[] = [];
const exposed: Record<string, unknown> = {};
const listeners: { channel: string }[] = [];

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (key: string, value: unknown) => {
      exposed[key] = value;
    },
  },
  ipcRenderer: {
    invoke: (channel: string, ...args: unknown[]) => {
      invoked.push({ channel, args });
      return Promise.resolve(undefined);
    },
    on: (channel: string) => {
      listeners.push({ channel });
    },
    removeListener: () => undefined,
  },
}));

let api: N10HostApi;

beforeAll(async () => {
  await import('./preload.js');
  api = exposed.n10 as N10HostApi;
});

/** Bridge methods that subscribe to pushed events instead of invoking. */
const EVENT_METHODS = [
  'onSessionData',
  'onSessionExit',
  'onLaunchStep',
  'onMenuCommand',
  'onSyncNotice',
  'onRemoteUpdated',
  'onDiscoveryChanged',
  'onBabysitChanged',
  'onMachinesChanged',
] as const;

describe('preload bridge', () => {
  it('exposes the API as window.n10', () => {
    expect(Object.keys(exposed)).toEqual(['n10']);
    expect(api).toBeTypeOf('object');
  });

  it('exposes exactly the contract: every channel plus the event subscriptions', () => {
    expect(new Set(Object.keys(api))).toEqual(
      new Set([...Object.keys(IPC), ...EVENT_METHODS])
    );
  });

  it.each(Object.entries(IPC))(
    '%s() invokes the %s channel',
    (method, channel) => {
      invoked.length = 0;
      const fn = (api as unknown as Record<string, () => unknown>)[method];
      expect(fn, `${method} is missing from the bridge`).toBeTypeOf('function');
      void fn.call(api);
      expect(invoked.map((i) => i.channel)).toEqual([channel]);
    }
  );

  it('forwards arguments untouched, in order, after the channel', () => {
    invoked.length = 0;
    const ref = { label: 'Personal Access Token', key: 'pat' };
    void api.updateSettingsField(ref, 'secret');
    void api.resizeSession('branch-a', 120, 40);
    expect(invoked).toEqual([
      { channel: IPC.updateSettingsField, args: [ref, 'secret'] },
      { channel: IPC.resizeSession, args: ['branch-a', 120, 40] },
    ]);
  });

  it('returns an unsubscribe function from every event subscription', () => {
    for (const method of EVENT_METHODS) {
      const off = (
        api as unknown as Record<string, (cb: () => void) => unknown>
      )[method](() => undefined);
      expect(off, `${method} must return an unsubscribe`).toBeTypeOf(
        'function'
      );
    }
  });
});
