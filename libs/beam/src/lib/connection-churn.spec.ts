/**
 * What a long-lived node accumulates across many connect/disconnect
 * cycles. Nothing else in the suite runs the cycle more than a handful of
 * times, and the things that leak here do not leak *visibly*: a per
 * connection liveness interval that is never cleared, or an accepted
 * socket the host keeps a reference to, both look exactly like a healthy
 * node until the machine has been up for a week.
 *
 * Real sockets and a real `Host`, because that is where the handles are:
 * an in-memory `TransportSocket` has no `ping`, so it gets no liveness
 * monitor at all and would prove nothing about the timer this exists to
 * catch.
 *
 * Sockets are counted through `process.getActiveResourcesInfo()`. Timers
 * are *not*: every timer beam creates is `unref`'d, and an unref'd timer
 * does not appear there at all — a leaked liveness interval leaves that
 * reading perfectly flat. So intervals are counted where they are made,
 * by wrapping `setInterval`/`clearInterval` for the duration of the run.
 * `liveness.ts` holds the only `setInterval` in the library, which is
 * exactly the handle at risk here: one per connection, cleared only by
 * the monitor's `stop`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dial, pair } from './client.js';
import { ConnectionRegistry } from './connection-registry.js';
import { Host } from './host.js';
import { loadOrCreateIdentity } from './identity.js';
import { PeerTable } from './peer-table.js';
import { StreamRegistry } from './stream-registry.js';

/** Enough cycles that a one-handle-per-cycle leak is an order of magnitude
 * larger than the noise, and few enough to stay a couple of seconds. */
const CYCLES = 40;

/** Handles in flight at the instant of a sample are ordinary — a socket
 * finishing its close, a fetch agent's keep-alive timer. A leak of one per
 * cycle shows up as ~CYCLES, so this separates the two without being
 * tuned to a particular machine. */
const TOLERANCE = 5;

let dirA: string;
let dirB: string;
let hostA: Host;

beforeEach(() => {
  dirA = mkdtempSync(join(tmpdir(), 'beam-churn-a-'));
  dirB = mkdtempSync(join(tmpdir(), 'beam-churn-b-'));
});

afterEach(async () => {
  await hostA.close();
  rmSync(dirA, { recursive: true, force: true });
  rmSync(dirB, { recursive: true, force: true });
});

function socketCount(): number {
  return process.getActiveResourcesInfo().filter((r) => r.startsWith('TCP'))
    .length;
}

/** Every `setInterval` still outstanding, counted at the source. Returns a
 * `live()` reading and the restore. Nothing here stubs the timer itself —
 * the real one still runs — so this observes the code under test rather
 * than replacing its clock. */
function countIntervals(): { live: () => number; restore: () => void } {
  const outstanding = new Set<unknown>();
  const realSet = globalThis.setInterval;
  const realClear = globalThis.clearInterval;
  const setSpy = vi.spyOn(globalThis, 'setInterval').mockImplementation(((
    ...args: Parameters<typeof setInterval>
  ) => {
    const handle = realSet(...args);
    outstanding.add(handle);
    return handle;
  }) as typeof setInterval);
  const clearSpy = vi.spyOn(globalThis, 'clearInterval').mockImplementation(((
    handle: Parameters<typeof clearInterval>[0]
  ) => {
    outstanding.delete(handle);
    realClear(handle);
  }) as typeof clearInterval);
  return {
    live: () => outstanding.size,
    restore: () => {
      setSpy.mockRestore();
      clearSpy.mockRestore();
    },
  };
}

/** Sample once the socket count has stopped moving, so one that is merely
 * mid-teardown is not read as a leak. Bounded: if it never settles, the
 * last reading is returned and the assertion decides. */
async function settledSockets(): Promise<number> {
  let previous = socketCount();
  for (let i = 0; i < 40; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    const next = socketCount();
    if (next === previous) return next;
    previous = next;
  }
  return previous;
}

describe('a node that is connected to and disconnected from many times', () => {
  it(
    'accumulates no timers, sockets or registry entries across the cycles',
    { timeout: 60_000 },
    async () => {
      const identityA = loadOrCreateIdentity(dirA, {
        hostname: () => 'workbox',
      });
      const peersA = new PeerTable(dirA);
      const connectionsA = new ConnectionRegistry();
      hostA = new Host({
        identity: identityA,
        peers: peersA,
        registry: new StreamRegistry(),
        connections: connectionsA,
        port: 0,
        capabilities: ['streams'],
      });
      await hostA.listen();

      const identityB = loadOrCreateIdentity(dirB, {
        hostname: () => 'laptop',
      });
      const peersB = new PeerTable(dirB);
      const registryB = new StreamRegistry();
      const connectionsB = new ConnectionRegistry();
      await pair(hostA.issuePairingUrl().url, peersB, { identity: identityB });

      const cycle = async (): Promise<void> => {
        const connection = await dial(hostA.baseUrl, identityA.peerId, {
          identity: identityB,
          peers: peersB,
          registry: registryB,
          connections: connectionsB,
        });
        // The positive control, run on every single cycle: a dial that
        // silently failed would leak nothing and pass every assertion
        // below. Both sides have to actually hold the connection.
        expect(connectionsB.get(identityA.peerId)).toBe(connection);
        await waitFor(() => connectionsA.get(identityB.peerId) !== undefined);
        connection.close();
        await waitFor(() => connectionsA.get(identityB.peerId) === undefined);
      };

      // Warm up first: the first dial creates undici's agent, the HTTP
      // server's own accept machinery and anything else built once. A
      // baseline taken before that measures the setup, not the cycle.
      for (let i = 0; i < 3; i += 1) await cycle();
      const socketsBefore = await settledSockets();

      const intervals = countIntervals();
      try {
        for (let i = 0; i < CYCLES; i += 1) await cycle();
        // Two monitors per cycle — the dialing side's and the accepting
        // side's — and every one of them has to have been stopped.
        expect(intervals.live()).toBe(0);
      } finally {
        intervals.restore();
      }
      const socketsAfter = await settledSockets();

      expect(connectionsA.list()).toEqual([]);
      expect(connectionsB.list()).toEqual([]);
      expect(socketsAfter - socketsBefore).toBeLessThanOrEqual(TOLERANCE);
    }
  );
});

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 5000
): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('timed out waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
