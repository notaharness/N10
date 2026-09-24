import { describe, expect, it } from 'vitest';
import { validBeamName } from './enrolment-model.js';
import { ceremonyHeading, ceremonyTarget } from './ceremony-copy.js';
import { ceremonyStep, EMPTY_CEREMONY } from './ceremony-model.js';

describe('fleet enrolment', () => {
  it('accepts defaults and scalar-value names but rejects unsafe or overlong names', () => {
    expect(
      [
        '',
        'buildbox',
        '🖥'.repeat(64),
        '🖥'.repeat(65),
        'a/b',
        'a\\b',
        'a{b}',
        'a\n',
        'a\u0085',
        '\ud800',
      ].map(validBeamName)
    ).toEqual([
      true,
      true,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it('changes both create step and QR, then removes the QR during publishing', () => {
    const create = ceremonyStep(EMPTY_CEREMONY, {
      kind: 'passkey',
      step: 'create',
      ceremonyUrl: 'https://beam.n10.is/#first',
    });
    const sign = ceremonyStep(create, {
      kind: 'passkey',
      step: 'sign',
      ceremonyUrl: 'https://beam.n10.is/#second',
    });
    expect(ceremonyHeading(create, 'init')).toContain('Step 1 of 2');
    expect(ceremonyHeading(sign, 'init')).toContain('Step 2 of 2');
    expect(sign.passkeyUrl).toBe('https://beam.n10.is/#second');
    const publishing = ceremonyStep(sign, {
      kind: 'stage',
      stage: 'publishing',
    });
    expect(publishing.passkeyUrl).toBeNull();
    expect(ceremonyHeading(publishing, 'init')).toBe('Publishing membership…');
    expect(ceremonyHeading(sign, 'join')).toBe('Authorize this machine');
    expect(ceremonyHeading(sign, 'revoke')).toBe('Authorize revocation');
  });

  it('shows the actual target of revocation, not the local machine or fleet ID', () => {
    expect(
      ceremonyTarget('https://beam.n10.is/#o=r&l=old+laptop&f=1234567890abcdef')
    ).toEqual({
      action: 'Remove machine',
      label: 'old laptop',
      fingerprint: '1234567890abcdef',
    });
    expect(ceremonyTarget('invalid')).toBeNull();
  });
});
