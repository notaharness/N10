import { describe, expect, it } from 'vitest';
import {
  EMPTY_CEREMONY,
  ceremonyOutcomeText,
  ceremonyStep,
} from './ceremony-model.js';

const FLEET = '3f9a0c4e7d12e805'.padEnd(64, '0');
const PEER = 'b7f39a210c4e55d1'.padEnd(32, '0');

describe('ceremonyStep', () => {
  it('walks init through both passkey steps and the daemon stages', () => {
    const view = [
      { kind: 'stage', stage: 'preparing network' },
      {
        kind: 'passkey',
        step: 'create',
        ceremonyUrl: 'https://beam.n10.is/#a',
      },
      { kind: 'passkey', step: 'sign', ceremonyUrl: 'https://beam.n10.is/#b' },
      { kind: 'stage', stage: 'publishing' },
    ].reduce(
      (v, p) => ceremonyStep(v, p as Parameters<typeof ceremonyStep>[1]),
      EMPTY_CEREMONY
    );
    expect(view.stages).toEqual([
      'preparing network',
      'waiting for your passkey (create)',
      'waiting for your passkey (sign)',
      'publishing',
    ]);
    expect(view.passkeyUrl).toBeNull();
  });

  it('shows the newest passkey URL while it waits, replacing the last', () => {
    const first = ceremonyStep(EMPTY_CEREMONY, {
      kind: 'passkey',
      step: 'create',
      ceremonyUrl: 'https://beam.n10.is/#a',
    });
    const second = ceremonyStep(first, {
      kind: 'passkey',
      step: 'sign',
      ceremonyUrl: 'https://beam.n10.is/#b',
    });
    expect(second.passkeyUrl).toBe('https://beam.n10.is/#b');
  });
});

describe('ceremonyOutcomeText', () => {
  it('init names the fleet and this machine by fingerprint', () => {
    expect(
      ceremonyOutcomeText(
        { ok: true, op: 'init', fleetId: FLEET, peerId: PEER, published: true },
        { thisMachine: 'laptop' }
      )
    ).toBe(
      'Created fleet 3f9a 0c4e 7d12 e805 · this machine: laptop (b7f3 9a21 0c4e 55d1) · published to directory'
    );
  });

  it('join names the fleet to compare and the members it learned', () => {
    expect(
      ceremonyOutcomeText({
        ok: true,
        op: 'join',
        fleetId: FLEET,
        members: 3,
        published: false,
      })
    ).toBe(
      'Joined fleet 3f9a 0c4e 7d12 e805; 3 other machines known; connecting…'
    );
  });

  it('revoke says where it took effect and who acknowledged it', () => {
    expect(
      ceremonyOutcomeText(
        { ok: true, op: 'revoke', published: false, acknowledgedBy: 2 },
        { others: 3 }
      )
    ).toBe('Revoked here · publication pending · acknowledged by 2 of 3 peers');
  });

  it('a failure is its message', () => {
    expect(
      ceremonyOutcomeText({
        ok: false,
        code: 'prf-unsupported',
        message:
          "This passkey provider doesn't support what beam needs; try another.",
      })
    ).toMatch(/passkey provider/);
  });
});
