import { describe, expect, it } from 'vitest';
import { failureCopy } from './ceremony-errors.js';

/** beam docs/06's error tokens, plus the host's own for a dropped
 *  connection. */
const WIRE_CODES = [
  'not-enrolled',
  'already-enrolled',
  'unknown-peer',
  'ambiguous-peer',
  'revoked-peer',
  'grant',
  'limit',
  'params',
  'offline',
  'spawn',
  'bad-entry',
  'wrong-passkey',
  'bad-assertion',
  'ceremony-timeout',
  'ceremony-state',
  'ceremony-cancelled',
  'prf-unsupported',
  'directory-unavailable',
  'queue-full',
  'storage-failure',
  'busy',
  'internal',
  'connection-lost',
];

describe('failureCopy', () => {
  it('has its own copy for every wire code beam sends', () => {
    const internal = failureCopy('internal').explanation;
    for (const code of WIRE_CODES.filter(
      (c) => c !== 'internal' && c !== 'limit' && c !== 'queue-full'
    )) {
      expect.soft(failureCopy(code).explanation).not.toBe(internal);
    }
  });

  it('reads an unknown code, or a prototype key, as internal', () => {
    expect(failureCopy('ceremony-failed')).toEqual(failureCopy('internal'));
    expect(failureCopy('toString')).toEqual(failureCopy('internal'));
  });

  it('offers at least one next action for every code', () => {
    for (const code of WIRE_CODES) {
      expect.soft(failureCopy(code).actions).not.toHaveLength(0);
    }
  });

  it('never offers a retry that cannot work', () => {
    // Another client's ceremony, and an identity beam will not take back.
    expect(failureCopy('busy').actions).not.toContain('retry');
    expect(failureCopy('revoked-peer').actions).not.toContain('retry');
  });

  it('points a PRF failure at the compatibility help', () => {
    expect(failureCopy('prf-unsupported').actions).toContain('compatibility');
  });
});
