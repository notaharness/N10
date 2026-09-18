import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectionRegistry, PeerTable, type HostDescriptor } from '@n10/beam';
import type * as Beam from '@n10/beam';
import { ReachabilityProber } from './beam-node-probe.js';

const state = vi.hoisted(() => ({
  calls: [] as string[],
  fail: new Set<string>(),
  descriptorFor: new Map<string, string>(),
}));

vi.mock('@n10/beam', async (importOriginal) => {
  const actual = await importOriginal<typeof Beam>();
  return {
    ...actual,
    fetchDescriptor: (baseUrl: string): Promise<HostDescriptor> => {
      state.calls.push(baseUrl);
      if (state.fail.has(baseUrl)) return Promise.reject(new Error('refused'));
      return Promise.resolve({
        peerId: state.descriptorFor.get(baseUrl) ?? 'wrong-id',
        label: 'x',
        protocol: 1,
        capabilities: [],
      });
    },
  };
});

let dir: string;
let peers: PeerTable;
let connections: ConnectionRegistry;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'beam-prober-'));
  peers = new PeerTable(dir);
  connections = new ConnectionRegistry();
  state.calls.length = 0;
  state.fail.clear();
  state.descriptorFor.clear();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function addPeer(id: string, endpoint: string | null, revoked = false) {
  peers.upsert({
    peerId: id,
    label: id,
    publicKeyPem: 'pem',
    endpoints: endpoint ? [endpoint] : [],
  });
  if (revoked) peers.revoke(id);
  if (endpoint) state.descriptorFor.set(endpoint, id);
}

describe('ReachabilityProber', () => {
  it('probes a peer with an endpoint and no connection, and reports reachable', async () => {
    addPeer('peer-1', 'http://a');
    const changes: number[] = [];
    const prober = new ReachabilityProber({
      peers,
      connections,
      intervalMs: 50_000,
      timeoutMs: 1000,
      onChange: () => changes.push(1),
    });
    prober.sync();
    await new Promise((r) => setTimeout(r, 20));
    expect(prober.get('peer-1')).toBe('reachable');
    expect(changes.length).toBeGreaterThan(0);
    prober.stop();
  });

  it('reports unreachable when the descriptor fetch fails', async () => {
    addPeer('peer-1', 'http://a');
    state.fail.add('http://a');
    const prober = new ReachabilityProber({
      peers,
      connections,
      intervalMs: 50_000,
      timeoutMs: 1000,
      onChange: () => undefined,
    });
    prober.sync();
    await new Promise((r) => setTimeout(r, 20));
    expect(prober.get('peer-1')).toBe('unreachable');
    prober.stop();
  });

  it('never probes a revoked peer, even with an endpoint', async () => {
    addPeer('peer-1', 'http://a', true);
    const prober = new ReachabilityProber({
      peers,
      connections,
      intervalMs: 50_000,
      timeoutMs: 1000,
      onChange: () => undefined,
    });
    prober.sync();
    await new Promise((r) => setTimeout(r, 20));
    expect(state.calls).toEqual([]);
    expect(prober.get('peer-1')).toBeUndefined();
    prober.stop();
  });

  it('never probes a peer with no endpoint', async () => {
    addPeer('peer-1', null);
    const prober = new ReachabilityProber({
      peers,
      connections,
      intervalMs: 50_000,
      timeoutMs: 1000,
      onChange: () => undefined,
    });
    prober.sync();
    await new Promise((r) => setTimeout(r, 20));
    expect(state.calls).toEqual([]);
    prober.stop();
  });

  it('stops ticking once nothing needs probing, and resumes when something does', async () => {
    const prober = new ReachabilityProber({
      peers,
      connections,
      intervalMs: 50_000,
      timeoutMs: 1000,
      onChange: () => undefined,
    });
    prober.sync(); // nothing to probe yet
    await new Promise((r) => setTimeout(r, 10));
    expect(state.calls).toEqual([]);

    addPeer('peer-1', 'http://a');
    prober.sync();
    await new Promise((r) => setTimeout(r, 20));
    expect(state.calls).toEqual(['http://a']);
    prober.stop();
  });
});
