import { describe, expect, it } from 'vitest';
import { ceremonySummary } from './ceremony-url.js';

const url = (fragment: string) => `https://beam.n10.is/#${fragment}`;

describe('ceremonySummary', () => {
  it('reads the action, machine and machine fingerprint beam put in the fragment', () => {
    expect(
      ceremonySummary(url('o=c&s=x&k=y&c=z&l=laptop&f=a1b2c3d4e5f60718&n=home'))
    ).toEqual({
      action: 'Create fleet passkey for “home”',
      machine: 'laptop',
      fingerprint: 'a1b2 c3d4 e5f6 0718',
    });
    expect(
      ceremonySummary(url('o=a&l=laptop&f=a1b2c3d4e5f60718'))?.action
    ).toBe('Add “laptop” to fleet');
    expect(
      ceremonySummary(url('o=r&l=workbox&f=c0ffee00c0ffee00'))?.action
    ).toBe('Remove “workbox” from fleet');
  });

  it('names the default fleet when a create omits it', () => {
    expect(
      ceremonySummary(url('o=c&l=laptop&f=a1b2c3d4e5f60718'))?.action
    ).toBe('Create fleet passkey for “beam”');
  });

  it('decodes a label as text, markup and all', () => {
    const label = encodeURIComponent('<b>dev & "ops"');
    expect(
      ceremonySummary(url(`o=a&l=${label}&f=a1b2c3d4e5f60718`))?.machine
    ).toBe('<b>dev & "ops"');
  });

  it('is null for a fragment it cannot vouch for, so nothing half-read is shown', () => {
    expect(ceremonySummary('https://beam.n10.is/')).toBeNull();
    expect(ceremonySummary(url('o=x&l=a&f=a1b2c3d4e5f60718'))).toBeNull();
    expect(
      ceremonySummary(url('o=toString&l=a&f=a1b2c3d4e5f60718'))
    ).toBeNull();
    expect(ceremonySummary(url('o=a&f=a1b2c3d4e5f60718'))).toBeNull();
    expect(ceremonySummary(url('o=a&l=a&f=A1B2C3D4E5F60718'))).toBeNull();
    expect(ceremonySummary(url('o=a&l=a&f=a1b2'))).toBeNull();
    expect(ceremonySummary(url('o=a&l=a%2Fb&f=a1b2c3d4e5f60718'))).toBeNull();
    expect(
      ceremonySummary(url('o=c&l=a&n=%7Bx%7D&f=a1b2c3d4e5f60718'))
    ).toBeNull();
    expect(ceremonySummary('not a url')).toBeNull();
  });
});
