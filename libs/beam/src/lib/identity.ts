/**
 * beam identity — one Ed25519 keypair per machine, used whether the machine
 * is accepting or dialing. `peerId` is derived from the public key rather
 * than minted, so both sides of a pairing independently compute the same id
 * for the same machine. See docs/beam.md.
 */

import { createHash, generateKeyPairSync } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { hostname as osHostname } from 'node:os';
import { join } from 'node:path';

export interface Identity {
  readonly peerId: string;
  readonly label: string;
  readonly publicKeyPem: string;
  readonly privateKeyPem: string;
}

/** `peerId`: first 16 hex characters of the SHA-256 of the public key PEM. */
export function derivePeerId(publicKeyPem: string): string {
  return createHash('sha256')
    .update(publicKeyPem, 'utf8')
    .digest('hex')
    .slice(0, 16);
}

interface StoredIdentity {
  label: string;
  publicKeyPem: string;
  privateKeyPem: string;
}

export interface LoadOrCreateIdentityOptions {
  /** Overridable for tests; defaults to `os.hostname()`. */
  hostname?: () => string;
}

/**
 * Load the identity persisted at `$beamDir/identity.json`, creating one on
 * first use. The file is written with mode 0600 and never overwritten once
 * it exists — a later default label never silently renames an identity that
 * is already paired under its original one.
 */
export function loadOrCreateIdentity(
  beamDir: string,
  options: LoadOrCreateIdentityOptions = {}
): Identity {
  const path = join(beamDir, 'identity.json');
  const existing = readStored(path);
  if (existing) return toIdentity(existing);

  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const stored: StoredIdentity = {
    label: (options.hostname ?? osHostname)(),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKeyPem: privateKey
      .export({ type: 'pkcs8', format: 'pem' })
      .toString(),
  };
  writeStoredAtomic(beamDir, path, stored);
  return toIdentity(stored);
}

/**
 * Rename this machine's own local display name. Never touches the
 * keypair or `peerId` — renaming is purely local and cosmetic, exactly
 * like renaming a peer in the peer table (`PeerTable.rename`).
 */
export function renameIdentity(beamDir: string, label: string): Identity {
  const path = join(beamDir, 'identity.json');
  const existing = readStored(path);
  if (!existing) throw new Error(`no identity stored at ${beamDir}`);
  const updated: StoredIdentity = { ...existing, label };
  writeStoredAtomic(beamDir, path, updated);
  return toIdentity(updated);
}

function readStored(path: string): StoredIdentity | null {
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, 'utf8');
  return JSON.parse(raw) as StoredIdentity;
}

function writeStoredAtomic(
  beamDir: string,
  path: string,
  stored: StoredIdentity
): void {
  mkdirSync(beamDir, { recursive: true, mode: 0o700 });
  const tmpPath = `${path}.${process.pid}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(stored, null, 2), { mode: 0o600 });
  renameSync(tmpPath, path);
}

function toIdentity(stored: StoredIdentity): Identity {
  return { ...stored, peerId: derivePeerId(stored.publicKeyPem) };
}
