import { describe, expect, it } from 'vitest';
import type { BeamStatus, MachineView } from '../../../host/contract.js';
import { fleetSectionSummary } from './section-summary.js';

const ready: BeamStatus = {
  state: 'ready',
  detail: null,
  enrolled: true,
  fleetId: 'f'.repeat(64),
};

function machine(over: Partial<MachineView>): MachineView {
  return {
    peerId: 'a'.repeat(32),
    label: 'workbox',
    isLocal: false,
    state: 'connected',
    path: 'direct',
    lastSeenAt: null,
    queued: 0,
    grant: 'all',
    inboundWaiting: [],
    inboundRefused: [],
    ...over,
  };
}

const self = machine({ peerId: 'b'.repeat(32), isLocal: true });

describe('fleetSectionSummary', () => {
  it('puts a waiting passkey step first, whatever beam says', () => {
    expect(
      fleetSectionSummary({
        beam: { ...ready, enrolled: false },
        machines: [self],
        awaitingPasskey: true,
      })
    ).toEqual({ text: 'Passkey step', tone: 'active' });
  });

  it('says nothing until beam can answer', () => {
    for (const state of ['connecting', 'starting'] as const) {
      expect(
        fleetSectionSummary({
          beam: { ...ready, state },
          machines: undefined,
          awaitingPasskey: false,
        })
      ).toBeNull();
    }
  });

  it('tells an unenrolled machine from one alone in its fleet', () => {
    expect(
      fleetSectionSummary({
        beam: { ...ready, enrolled: false, fleetId: null },
        machines: [self],
        awaitingPasskey: false,
      })?.text
    ).toBe('Not set up');
    expect(
      fleetSectionSummary({
        beam: ready,
        machines: [self],
        awaitingPasskey: false,
      })?.text
    ).toBe('This machine');
  });

  it('warns when a member is offline', () => {
    expect(
      fleetSectionSummary({
        beam: ready,
        machines: [self, machine({ state: 'offline' })],
        awaitingPasskey: false,
      })
    ).toEqual({ text: '2 machines · 1 offline', tone: 'warning' });
  });

  it('warns when beam is unavailable', () => {
    expect(
      fleetSectionSummary({
        beam: { ...ready, state: 'unavailable' },
        machines: undefined,
        awaitingPasskey: false,
      })?.tone
    ).toBe('warning');
  });
});
