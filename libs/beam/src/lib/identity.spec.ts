import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  derivePeerId,
  loadOrCreateIdentity,
  renameIdentity,
} from './identity.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'beam-identity-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('derivePeerId', () => {
  it('is deterministic for the same public key', () => {
    const pem = '-----BEGIN PUBLIC KEY-----\nabc\n-----END PUBLIC KEY-----\n';
    expect(derivePeerId(pem)).toBe(derivePeerId(pem));
  });

  it('is exactly 16 lowercase hex characters', () => {
    const id = derivePeerId('anything');
    expect(id).toMatch(/^[0-9a-f]{16}$/);
  });

  it('differs for different keys', () => {
    expect(derivePeerId('key-a')).not.toBe(derivePeerId('key-b'));
  });
});

describe('loadOrCreateIdentity', () => {
  it('creates a fresh identity whose peerId matches its own public key', () => {
    const identity = loadOrCreateIdentity(dir);
    expect(identity.peerId).toBe(derivePeerId(identity.publicKeyPem));
  });

  it('defaults label to the provided hostname', () => {
    const identity = loadOrCreateIdentity(dir, { hostname: () => 'workbox' });
    expect(identity.label).toBe('workbox');
  });

  it('writes identity.json with mode 0600', () => {
    loadOrCreateIdentity(dir);
    const path = join(dir, 'identity.json');
    expect(existsSync(path)).toBe(true);
    const mode = statSync(path).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('reuses the stored keypair on a second load instead of minting a new one', () => {
    const first = loadOrCreateIdentity(dir, { hostname: () => 'a' });
    const second = loadOrCreateIdentity(dir, { hostname: () => 'b' });
    expect(second.peerId).toBe(first.peerId);
    expect(second.publicKeyPem).toBe(first.publicKeyPem);
    expect(second.privateKeyPem).toBe(first.privateKeyPem);
    // The label persists from the first creation; a later default hostname
    // does not silently rename an existing identity.
    expect(second.label).toBe('a');
  });

  it('persists a stable identity.json across loads (not rewritten each time)', () => {
    loadOrCreateIdentity(dir);
    const raw1 = readFileSync(join(dir, 'identity.json'), 'utf8');
    loadOrCreateIdentity(dir);
    const raw2 = readFileSync(join(dir, 'identity.json'), 'utf8');
    expect(raw2).toBe(raw1);
  });
});

describe('renameIdentity', () => {
  it('changes the label without touching the keypair or peerId', () => {
    const before = loadOrCreateIdentity(dir, { hostname: () => 'laptop' });
    const after = renameIdentity(dir, 'my-laptop');
    expect(after.label).toBe('my-laptop');
    expect(after.peerId).toBe(before.peerId);
    expect(after.publicKeyPem).toBe(before.publicKeyPem);
    expect(after.privateKeyPem).toBe(before.privateKeyPem);
    // Persisted, not just returned.
    expect(loadOrCreateIdentity(dir).label).toBe('my-laptop');
  });

  it('throws when there is no identity to rename yet', () => {
    expect(() => renameIdentity(dir, 'x')).toThrow(/no identity/);
  });
});
