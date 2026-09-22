import { createHash, createPrivateKey, createPublicKey } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { derivePeerId } from '@n10/beam';

/**
 * Deterministic beam identities for the e2e suite.
 *
 * `loadOrCreateIdentity` mints a fresh Ed25519 keypair the first time a
 * node starts in a directory, and defaults the label to
 * `os.hostname()`. Both are shown in the machines UI — the label in
 * every machine row, the `peerId` as a grouped fingerprint beside it —
 * so a screenshot taken against a generated identity can never match a
 * baseline: the keypair is new per fixture HOME, and the hostname is a
 * fresh container id per `docker run`.
 *
 * Seeding `identity.json` before launch pins both, the same way
 * `seedPeerTable` pins the peer table. `loadOrCreateIdentity` never
 * overwrites a file that is already there, so the app adopts this
 * identity verbatim — which makes the fingerprint assertable rather
 * than merely stable.
 */

/** PKCS#8 header for an Ed25519 private key carrying a 32-byte seed:
 *  SEQUENCE { version 0, AlgorithmIdentifier { 1.3.101.112 },
 *  OCTET STRING { OCTET STRING (32 bytes) } }. Node builds the matching
 *  public key from it, so a keypair is a pure function of the seed and
 *  nothing has to be committed as an opaque PEM blob. */
const PKCS8_ED25519_SEED_PREFIX = Buffer.from(
  '302e020100300506032b657004220420',
  'hex'
);

export interface Keypair {
  publicKeyPem: string;
  privateKeyPem: string;
}

/** The one Ed25519 keypair `phrase` names — same phrase, same key, on
 *  every machine and every run. */
export function deterministicKeypair(phrase: string): Keypair {
  const seed = createHash('sha256').update(phrase, 'utf8').digest();
  const privateKey = createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519_SEED_PREFIX, seed]),
    format: 'der',
    type: 'pkcs8',
  });
  return {
    publicKeyPem: createPublicKey(privateKey)
      .export({ type: 'spki', format: 'pem' })
      .toString(),
    privateKeyPem: privateKey
      .export({ type: 'pkcs8', format: 'pem' })
      .toString(),
  };
}

/** `$BEAM_DIR` for an isolated fixture HOME. The fixture sets
 *  `XDG_CONFIG_HOME` to `$HOME/.config` and scrubs `BEAM_CONFIG_DIR`,
 *  so `resolveBeamDir` lands exactly here. */
export function beamDirIn(homeDir: string): string {
  return join(homeDir, '.config', 'beam');
}

/** `a1b2c3d4e5f60718` → `a1b2 c3d4 e5f6 0718`, mirroring the renderer's
 *  `fingerprintGroups` so a test can assert the rendered text. */
export function fingerprint(peerId: string): string {
  return (peerId.match(/.{1,4}/g) ?? [peerId]).join(' ');
}

/** The label every test's local machine goes by. Deliberately not a
 *  hostname: nothing here should read as the developer's machine. */
export const LOCAL_MACHINE_LABEL = 'n10-e2e-machine';

const LOCAL_MACHINE_KEYPAIR = deterministicKeypair('n10-e2e-local-identity');

/** The `peerId` the app derives from the seeded identity — the first 16
 *  hex of the SHA-256 of that public key PEM. */
export const LOCAL_MACHINE_PEER_ID = derivePeerId(
  LOCAL_MACHINE_KEYPAIR.publicKeyPem
);

/** What `fingerprintGroups` renders that `peerId` as, in the local
 *  machine's row. */
export const LOCAL_MACHINE_FINGERPRINT = fingerprint(LOCAL_MACHINE_PEER_ID);

/**
 * Write `identity.json` into the isolated HOME's beam dir before the
 * app starts. Mode 0600 and the same shape `loadOrCreateIdentity`
 * persists, so the app reads it back rather than minting its own.
 */
export function seedIdentity(homeDir: string): void {
  const dir = beamDirIn(homeDir);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(
    join(dir, 'identity.json'),
    JSON.stringify(
      { label: LOCAL_MACHINE_LABEL, ...LOCAL_MACHINE_KEYPAIR },
      null,
      2
    ),
    { mode: 0o600 }
  );
}
