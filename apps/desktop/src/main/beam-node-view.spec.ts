import { describe, expect, it } from 'vitest';
import type { PeerRecord } from '@n10/beam';
import { localMachineView, peerMachineView } from './beam-node-view.js';

/**
 * The state → presentation mapping D6 fixes, as a pure function. Two
 * rules matter more than the rest: a peer with no endpoint is
 * `no-endpoint`, never a fault, and a peer that has not been probed yet
 * is `unknown`, never `unreachable` (a healthy unprobed machine must
 * never look down).
 */

function record(overrides: Partial<PeerRecord> = {}): PeerRecord {
  return {
    peerId: 'peer-1',
    label: 'workbox',
    publicKeyPem: 'pem',
    endpoints: ['http://10.0.0.2:4000'],
    pairedAt: 1_000,
    revoked: false,
    ...overrides,
  };
}

function status(
  overrides: Partial<{
    peerId: string;
    label: string;
    revoked: boolean;
    queueDepth: number;
  }> = {}
) {
  return {
    peerId: 'peer-1',
    label: 'workbox',
    revoked: false,
    queueDepth: 0,
    ...overrides,
  };
}

describe('localMachineView', () => {
  it('is always connected, never paired, and carries its own endpoints', () => {
    const local = localMachineView('local-id', 'my-mac', ['http://a']);
    expect(local).toEqual({
      peerId: 'local-id',
      label: 'my-mac',
      isLocal: true,
      state: 'connected',
      transport: null,
      endpoints: ['http://a'],
      lastSeenAt: null,
      queueDepth: 0,
      pairedAt: null,
      revokedAt: null,
    });
  });
});

describe('peerMachineView', () => {
  it('is connected when a live connection exists, whatever the probe says', () => {
    const view = peerMachineView(status(), record(), true, 'unreachable');
    expect(view.state).toBe('connected');
    expect(view.transport).toBe('WebSocket');
  });

  it('is no-endpoint when the peer has none, not a probe result', () => {
    const view = peerMachineView(
      status(),
      record({ endpoints: [] }),
      false,
      'reachable'
    );
    expect(view.state).toBe('no-endpoint');
  });

  it('is unknown — never unreachable — before any probe has run', () => {
    const view = peerMachineView(status(), record(), false, undefined);
    expect(view.state).toBe('unknown');
  });

  it('reports the probe result once one exists', () => {
    expect(peerMachineView(status(), record(), false, 'reachable').state).toBe(
      'reachable'
    );
    expect(
      peerMachineView(status(), record(), false, 'unreachable').state
    ).toBe('unreachable');
  });

  it('is revoked regardless of connection or probe state — orthogonal, per D6', () => {
    const view = peerMachineView(
      status({ revoked: true }),
      record({ revoked: true }),
      true,
      'reachable'
    );
    expect(view.state).toBe('revoked');
  });

  it('carries queue depth through untouched, zero or non-zero', () => {
    expect(
      peerMachineView(status({ queueDepth: 0 }), record(), false).queueDepth
    ).toBe(0);
    expect(
      peerMachineView(status({ queueDepth: 3 }), record(), false).queueDepth
    ).toBe(3);
  });
});
