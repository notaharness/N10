import type { BeamStatus, MachineView } from '../../../host/contract.js';

/**
 * A small beam fleet: this laptop, a desktop at home and a rented
 * server, all connected, and an old machine that has been offline for a
 * few days with mail queued for it. peerIds are beam's 32 hex digits.
 */
export const LAPTOP = '5f0c2a9e41d7b8c36e1f4a2d9b07c5e8';
export const STUDIO = 'a3e81c4f0b9d27e65c1a8f3b4d2e9c70';
export const SERVER = 'c7d2e5a19f3b048e6a2c1d9f7b5e3a84';
const OLD_IMAC = '19b4f7e2c8a05d3e7f1c6b9a2d4e8f05';

const DAY = 86_400_000;

export function machines(): MachineView[] {
  const now = Date.now();
  const base = {
    queued: 0,
    inboundWaiting: [],
    inboundRefused: [],
  };
  return [
    {
      ...base,
      peerId: LAPTOP,
      label: 'thinkpad',
      isLocal: true,
      state: 'connected',
      path: null,
      lastSeenAt: now,
      grant: 'all',
    },
    {
      ...base,
      peerId: STUDIO,
      label: 'studio',
      isLocal: false,
      state: 'connected',
      path: 'direct',
      lastSeenAt: now - 4_000,
      grant: 'all',
    },
    {
      ...base,
      peerId: SERVER,
      label: 'hetzner-cx42',
      isLocal: false,
      state: 'connected',
      path: 'relay fra',
      lastSeenAt: now - 9_000,
      grant: 'all',
    },
    {
      ...base,
      peerId: OLD_IMAC,
      label: 'old-imac',
      isLocal: false,
      state: 'offline',
      path: 'unknown',
      lastSeenAt: now - 3 * DAY,
      grant: 'msg',
      queued: 2,
    },
  ];
}

export const BEAM_STATUS: BeamStatus = {
  state: 'ready',
  detail: null,
  enrolled: true,
  fleetId: '8e2f5c1a7b3d9e4f',
};
