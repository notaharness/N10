import { describe, expect, it } from 'vitest';
import type { MachineView } from '../../../host/contract-machines.js';
import {
  fingerprintGroups,
  formatCountdown,
  hasPeerMachines,
  inboundMailRows,
  inboundRefusedBadgeLabel,
  inboundWaitingBadgeLabel,
  isMachineSelectable,
  launchStepLabel,
  machinePresentation,
  machineSelectOptions,
  oldestInboundMailAge,
  queueBadgeLabel,
  resolveMachineLabel,
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
    inboundWaiting: [],
    inboundRefused: [],
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

describe('inbound mail (Phase 8: the desktop as a mailbox subscriber)', () => {
  it('badges are null when there is nothing waiting or refused', () => {
    const m = machine();
    expect(inboundWaitingBadgeLabel(m)).toBeNull();
    expect(inboundRefusedBadgeLabel(m)).toBeNull();
    expect(oldestInboundMailAge(m)).toBeNull();
  });

  it('names the count once non-zero, for each list independently', () => {
    const m = machine({
      inboundWaiting: [{ id: 'a', target: 'tmux:x', receivedAt: 1 }],
      inboundRefused: [
        { id: 'b', target: 'tmux:y', reason: 'nope', receivedAt: 1 },
        { id: 'c', target: 'tmux:z', reason: 'nope', receivedAt: 1 },
      ],
    });
    expect(inboundWaitingBadgeLabel(m)).toBe('1 waiting to be delivered');
    expect(inboundRefusedBadgeLabel(m)).toBe('2 refused');
  });

  it('rows are sorted oldest first and carry the reason only when refused', () => {
    const rows = inboundMailRows([
      { id: 'newer', target: 'tmux:x', receivedAt: 2000 },
      {
        id: 'older',
        target: 'tmux:y',
        reason: 'a shell owns it',
        receivedAt: 1000,
      },
    ]);
    expect(rows.map((r) => r.id)).toEqual(['older', 'newer']);
    expect(rows[0]?.reason).toBe('a shell owns it');
    expect(rows[1]?.reason).toBeUndefined();
  });
});

const local = machine({
  peerId: 'me',
  label: 'You',
  isLocal: true,
  state: 'connected',
});

describe('hasPeerMachines (D8)', () => {
  it('is false with only the local machine — the gate every surface checks', () => {
    expect(hasPeerMachines([local])).toBe(false);
  });

  it('is true the moment a peer is registered, whatever its state', () => {
    expect(hasPeerMachines([local, machine({ state: 'unknown' })])).toBe(true);
  });

  it('is false for an empty list', () => {
    expect(hasPeerMachines([])).toBe(false);
  });
});

describe('isMachineSelectable', () => {
  it('the local machine is always selectable', () => {
    expect(isMachineSelectable(local)).toBe(true);
  });

  it('connected and reachable peers are selectable', () => {
    expect(isMachineSelectable(machine({ state: 'connected' }))).toBe(true);
    expect(isMachineSelectable(machine({ state: 'reachable' }))).toBe(true);
  });

  it('unreachable, unknown, no-endpoint and revoked peers are not', () => {
    for (const state of [
      'unreachable',
      'unknown',
      'no-endpoint',
      'revoked',
    ] as const) {
      expect(isMachineSelectable(machine({ state }))).toBe(false);
    }
  });
});

describe('machineSelectOptions', () => {
  it('enabled options carry no reason', () => {
    const [opt] = machineSelectOptions([machine({ state: 'connected' })]);
    expect(opt).toMatchObject({ disabled: false, reason: null });
  });

  it('a disabled option always carries its reason, never omits it', () => {
    const [opt] = machineSelectOptions([
      machine({ state: 'unreachable', lastSeenAt: Date.now() - 60_000 }),
    ]);
    expect(opt.disabled).toBe(true);
    expect(opt.reason).toMatch(/^Unreachable — last seen/);
  });

  it('no-endpoint is disabled but its reason never reads as a fault', () => {
    const [opt] = machineSelectOptions([
      machine({ state: 'no-endpoint', endpoints: [] }),
    ]);
    expect(opt.disabled).toBe(true);
    expect(opt.reason).toBe(
      'Can reach us only — this machine cannot be dialled from here'
    );
  });

  it('unknown is disabled with "Checking…", never "Unreachable"', () => {
    const [opt] = machineSelectOptions([machine({ state: 'unknown' })]);
    expect(opt.reason).toBe('Checking…');
  });
});

describe('resolveMachineLabel', () => {
  const machines = [local, machine({ peerId: 'peer-1', label: 'workbox' })];

  it('is null for local — the caller shows no prefix at all', () => {
    expect(resolveMachineLabel('local', machines)).toBeNull();
    expect(resolveMachineLabel(undefined, machines)).toBeNull();
  });

  it('resolves a registered peer to its label, never the bare id', () => {
    expect(resolveMachineLabel('peer-1', machines)).toBe('workbox');
  });

  it('names a machine no longer in the registered list rather than vanishing', () => {
    expect(resolveMachineLabel('gone-peer', machines)).toBe('Unknown machine');
  });

  it('is honest even before the machines list has loaded', () => {
    expect(resolveMachineLabel('peer-1', undefined)).toBe('Unknown machine');
  });
});

describe('launchStepLabel', () => {
  it('names the worktree step by machine', () => {
    expect(launchStepLabel('worktree', 'workbox', 'claude')).toBe(
      'Creating worktree on workbox…'
    );
  });

  it('names the start step by what is being started, not the machine', () => {
    expect(launchStepLabel('start', 'workbox', 'claude')).toBe(
      'Starting claude…'
    );
    expect(launchStepLabel('start', 'workbox', 'shell')).toBe(
      'Starting shell…'
    );
  });
});
