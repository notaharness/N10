/**
 * The fingerprint a human compares out of band when pairing (SSH-style
 * trust-on-first-use): the full SHA-256 of the public key, grouped in
 * fours. `derivePeerId` (libs/beam) truncates the same hash to its first 16
 * hex characters, so a peerId is always this fingerprint's first group.
 */

import { createHash } from 'node:crypto';

export function fingerprintFor(publicKeyPem: string): string {
  const hex = createHash('sha256').update(publicKeyPem, 'utf8').digest('hex');
  return (hex.match(/.{1,4}/g) ?? [hex]).join(' ');
}
