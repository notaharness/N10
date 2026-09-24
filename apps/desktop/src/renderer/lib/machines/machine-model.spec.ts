import { describe, expect, it } from 'vitest';
import type { MachineView } from '../../../host/contract-machines.js';
import {
  fingerprintGroups,
  hasPeerMachines,
  inboundMailRows,
  inboundRefusedBadgeLabel,
  inboundWaitingBadgeLabel,
  isMachineSelectable,
  launchStepLabel,
  machineChoice,
  machinePresentation,
  machineSelectOptions,
  oldestInboundMailAge,
  queueBadgeLabel,
  resolveMachineLabel,
} from './machine-model.js';

function machine(overrides: Partial<MachineView> = {}): MachineView {
  return {
    peerId: 'a1b2c3d4e5f60718a1b2c3d4e5f60718',
    label: 'workbox',
    isLocal: false,
    state: 'offline',
    path: 'unknown',
    lastSeenAt: null,
    grant: 'all',
    queued: 0,
    inboundWaiting: [],
    inboundRefused: [],
    ...overrides,
  };
}

describe('machinePresentation', () => {
  it('this machine: its own label, with no invented network path', () => {
    const p = machinePresentation(
      machine({ state: 'connected', isLocal: true, path: null })
    );
    expect(p).toEqual({
      label: 'This machine',
      tone: 'success',
      secondary: '',
    });
  });

  it('connected: the route it takes, in words', () => {
    const route = (path: string) =>
      machinePresentation(machine({ state: 'connected', path }));
    expect(route('direct')).toEqual({
      label: 'Connected',
      tone: 'success',
      secondary: 'Direct',
    });
    expect(route('relay fra').secondary).toBe('Relay fra');
    expect(route('unknown').secondary).toBe('Path unknown');
  });

  it('offline: muted, never a fault, with when it was last seen', () => {
    const p = machinePresentation(
      machine({ state: 'offline', lastSeenAt: Date.now() - 5 * 60_000 })
    );
    expect(p.label).toBe('Offline');
    expect(p.tone).toBe('muted');
    expect(p.secondary).toBe('Last seen 5m ago');
    expect(machinePresentation(machine()).secondary).toBe('Not connected yet');
  });

  it('revoked here and revoked by the fleet are both destructive, and read apart', () => {
    const here = machinePresentation(machine({ state: 'revoked' }));
    const there = machinePresentation(machine({ state: 'revoked-by-fleet' }));
    expect(here).toEqual({
      label: 'Revoked',
      tone: 'destructive',
      secondary: '',
    });
    expect(there).toEqual({
      label: 'Refuses this machine',
      tone: 'destructive',
      secondary: 'This machine was revoked from that peer’s fleet view.',
    });
  });

  it('every state maps to a distinct label — no two states read the same', () => {
    const states = [
      'connected',
      'offline',
      'revoked',
      'revoked-by-fleet',
    ] as const;
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

describe('queueBadgeLabel', () => {
  it('is null at zero — no badge at all, not "0 queued"', () => {
    expect(queueBadgeLabel(0)).toBeNull();
  });

  it('names the count once non-zero', () => {
    expect(queueBadgeLabel(1)).toBe('1 queued');
    expect(queueBadgeLabel(4)).toBe('4 queued');
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
    expect(inboundWaitingBadgeLabel(m)).toBe('1 waiting');
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
  peerId: 'aaaaaaaaaaaaaaaa',
  label: 'You',
  isLocal: true,
  state: 'connected',
});

describe('hasPeerMachines (D8)', () => {
  it('is false with only the local machine — the gate every surface checks', () => {
    expect(hasPeerMachines([local])).toBe(false);
  });

  it('is true the moment a peer is registered, whatever its state', () => {
    expect(hasPeerMachines([local, machine({ state: 'offline' })])).toBe(true);
  });

  it('is false for an empty list', () => {
    expect(hasPeerMachines([])).toBe(false);
  });
});

describe('isMachineSelectable', () => {
  it('the local machine is always selectable', () => {
    expect(isMachineSelectable(local)).toBe(true);
  });

  it('a connected peer is selectable', () => {
    expect(isMachineSelectable(machine({ state: 'connected' }))).toBe(true);
  });

  it('offline and revoked peers, either way round, are not', () => {
    for (const state of ['offline', 'revoked', 'revoked-by-fleet'] as const) {
      expect(isMachineSelectable(machine({ state }))).toBe(false);
    }
  });
});

describe('machineChoice', () => {
  const reachable = machine({ peerId: 'bbbbbbbbbbbbbbbb', state: 'connected' });

  it('defaults to the local machine, which a launch names as no machine at all', () => {
    const { value, remote } = machineChoice([local, reachable], null);
    expect(value).toBe('aaaaaaaaaaaaaaaa');
    expect(remote).toBeUndefined();
  });

  it('carries a selectable peer through to the request', () => {
    expect(machineChoice([local, reachable], 'bbbbbbbbbbbbbbbb')).toEqual({
      value: 'bbbbbbbbbbbbbbbb',
      remote: 'bbbbbbbbbbbbbbbb',
    });
  });

  it('drops a pick that has stopped being selectable while the dialog sat open', () => {
    // The `Select` disables the option but keeps its value, so without
    // this the launch goes out against a machine already known to be
    // unusable and fails a round trip later. Local is both what is
    // sent and what the control shows — they never disagree.
    for (const state of ['offline', 'revoked', 'revoked-by-fleet'] as const) {
      const gone = machine({ peerId: 'bbbbbbbbbbbbbbbb', state });
      expect(machineChoice([local, gone], 'bbbbbbbbbbbbbbbb')).toEqual({
        value: 'aaaaaaaaaaaaaaaa',
        remote: undefined,
      });
    }
  });

  it('drops a pick for a machine that has left the list entirely', () => {
    expect(machineChoice([local], 'bbbbbbbbbbbbbbbb')).toEqual({
      value: 'aaaaaaaaaaaaaaaa',
      remote: undefined,
    });
  });

  it('D8: with only the local machine there is nothing remote to name', () => {
    expect(machineChoice([local], null).remote).toBeUndefined();
  });
});

describe('machineSelectOptions', () => {
  it('enabled options carry no reason', () => {
    const [opt] = machineSelectOptions([machine({ state: 'connected' })]);
    expect(opt).toMatchObject({ disabled: false, reason: null });
  });

  it('a disabled option always carries its reason, never omits it', () => {
    const [opt] = machineSelectOptions([
      machine({ state: 'offline', lastSeenAt: Date.now() - 60_000 }),
    ]);
    expect(opt.disabled).toBe(true);
    expect(opt.reason).toMatch(/^Offline — Last seen/);
  });
});

describe('resolveMachineLabel', () => {
  const machines = [
    local,
    machine({ peerId: 'bbbbbbbbbbbbbbbb', label: 'workbox' }),
  ];

  it('is null for local — the caller shows no prefix at all', () => {
    expect(resolveMachineLabel('local', machines)).toBeNull();
    expect(resolveMachineLabel(undefined, machines)).toBeNull();
  });

  it('resolves a registered peer to its label, never the bare id', () => {
    expect(resolveMachineLabel('bbbbbbbbbbbbbbbb', machines)).toBe('workbox');
  });

  it('names a machine no longer in the registered list rather than vanishing', () => {
    expect(resolveMachineLabel('0123456789abcdef', machines)).toBe(
      'Unknown machine'
    );
  });

  it('is honest even before the machines list has loaded', () => {
    expect(resolveMachineLabel('bbbbbbbbbbbbbbbb', undefined)).toBe(
      'Unknown machine'
    );
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
