import { describe, expect, it } from 'vitest';
import type { MachineView } from '../../../host/contract-machines.js';
import {
  fingerprintGroups,
  formatCountdown,
  machinePresentation,
  queueBadgeLabel,
} from './machine-model.js';

function machine(overrides: Partial<MachineView> = {}): MachineView {
  return {
    peerId: 'a1b2c3d4e5f60718',
    label: 'workbox',
    isLocal: false,
    state: 'unknown',
    transport: null,
    endpoints: ['http://10.0.0.2:4000'],
    lastSeenAt: null,
    queueDepth: 0,
    pairedAt: 1000,
    revokedAt: null,
    ...overrides,
  };
}

describe('machinePresentation', () => {
  it('connected: success tone, transport as secondary', () => {
    const p = machinePresentation(
      machine({ state: 'connected', transport: 'WebSocket' })
    );
    expect(p).toEqual({
      label: 'Connected',
      tone: 'success',
      secondary: 'WebSocket',
    });
  });

  it('reachable: muted tone, the endpoint as secondary', () => {
    const p = machinePresentation(machine({ state: 'reachable' }));
    expect(p.label).toBe('Reachable');
    expect(p.tone).toBe('muted');
    expect(p.secondary).toBe('http://10.0.0.2:4000');
  });

  it('unreachable: warning tone, never mistaken for no-endpoint or a crash', () => {
    const p = machinePresentation(
      machine({ state: 'unreachable', lastSeenAt: Date.now() - 60_000 })
    );
    expect(p.label).toBe('Unreachable');
    expect(p.tone).toBe('warning');
    expect(p.secondary).toMatch(/^last seen/);
  });

  it('unknown: muted tone, no secondary claiming it is down — must never say Unreachable', () => {
    const p = machinePresentation(machine({ state: 'unknown' }));
    expect(p.label).toBe('Checking…');
    expect(p.label).not.toMatch(/unreachable/i);
    expect(p.tone).toBe('muted');
  });

  it('no-endpoint: info tone — must never read as a fault (warning/destructive)', () => {
    const p = machinePresentation(
      machine({ state: 'no-endpoint', endpoints: [] })
    );
    expect(p.label).toBe('Can reach us only');
    expect(p.tone).toBe('info');
    expect(p.tone).not.toBe('warning');
    expect(p.tone).not.toBe('destructive');
  });

  it('revoked: destructive tone, orthogonal to connection/probe state', () => {
    const p = machinePresentation(
      machine({ state: 'revoked', revokedAt: Date.now() - 3_600_000 })
    );
    expect(p.label).toBe('Revoked');
    expect(p.tone).toBe('destructive');
    expect(p.secondary).toMatch(/^revoked/);
  });

  it('every state maps to a distinct label — no two states read the same', () => {
    const states: MachineView['state'][] = [
      'connected',
      'reachable',
      'unreachable',
      'unknown',
      'no-endpoint',
      'revoked',
    ];
    const labels = states.map(
      (state) => machinePresentation(machine({ state })).label
    );
    expect(new Set(labels).size).toBe(states.length);
  });
});

describe('fingerprintGroups', () => {
  it('groups a 16-hex peerId into fours', () => {
    expect(fingerprintGroups('a1b2c3d4e5f60718')).toBe('a1b2 c3d4 e5f6 0718');
  });

  it('handles a length not divisible by four without dropping characters', () => {
    expect(fingerprintGroups('abc')).toBe('abc');
    expect(fingerprintGroups('abcde')).toBe('abcd e');
  });
});

describe('formatCountdown', () => {
  it('formats minutes and seconds, zero-padded', () => {
    expect(formatCountdown(9 * 60_000 + 41_000)).toBe('9:41');
    expect(formatCountdown(5_000)).toBe('0:05');
  });

  it('never goes negative — floors at 0:00', () => {
    expect(formatCountdown(-5_000)).toBe('0:00');
    expect(formatCountdown(0)).toBe('0:00');
  });

  it('rounds up to the next full second so it never briefly reads 0:00 while still counting', () => {
    expect(formatCountdown(500)).toBe('0:01');
  });
});

describe('queueBadgeLabel', () => {
  it('is null at zero — no badge at all, not "0 waiting"', () => {
    expect(queueBadgeLabel(0)).toBeNull();
  });

  it('names the count once non-zero', () => {
    expect(queueBadgeLabel(1)).toBe('1 waiting');
    expect(queueBadgeLabel(4)).toBe('4 waiting');
  });
});
