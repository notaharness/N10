import { beforeEach, describe, expect, it } from 'vitest';
import type { MachineView } from '../contract-machines.js';
import {
  dismissInboundMail,
  setInboundMailChangeNotifier,
  setInboundMailPort,
  withMailOverlay,
} from './inbound-mail.js';

function machine(peerId: string): MachineView {
  return {
    peerId,
    label: peerId,
    isLocal: false,
    state: 'connected',
    transport: 'WebSocket',
    endpoints: [],
    lastSeenAt: null,
    queueDepth: 0,
    pairedAt: null,
    revokedAt: null,
    inboundWaiting: [],
    inboundRefused: [],
  };
}

beforeEach(() => {
  setInboundMailPort(null);
  setInboundMailChangeNotifier(null);
});

describe('withMailOverlay', () => {
  it('leaves machines untouched when no port is installed', () => {
    expect(withMailOverlay([machine('bbbbbbbbbbbbbbbb')])).toEqual([
      machine('bbbbbbbbbbbbbbbb'),
    ]);
  });

  it('overlays each machine with its own snapshot, by peerId', () => {
    setInboundMailPort({
      snapshotFor: (peerId: string) =>
        peerId === 'bbbbbbbbbbbbbbbb'
          ? {
              inboundWaiting: [{ id: 'e1', target: 'tmux:x', receivedAt: 1 }],
              inboundRefused: [],
            }
          : { inboundWaiting: [], inboundRefused: [] },
      dismiss: () => undefined,
    });
    const [a, b] = withMailOverlay([
      machine('bbbbbbbbbbbbbbbb'),
      machine('cccccccccccccccc'),
    ]);
    expect(a.inboundWaiting).toHaveLength(1);
    expect(b.inboundWaiting).toEqual([]);
  });
});

describe('dismissInboundMail', () => {
  it('rejects when no port is installed', async () => {
    await expect(dismissInboundMail('e1')).rejects.toThrow(/not available/);
  });

  it('forwards to the installed port', async () => {
    const dismissed: string[] = [];
    setInboundMailPort({
      snapshotFor: () => ({ inboundWaiting: [], inboundRefused: [] }),
      dismiss: (id: string) => dismissed.push(id),
    });
    await dismissInboundMail('e1');
    expect(dismissed).toEqual(['e1']);
  });
});
