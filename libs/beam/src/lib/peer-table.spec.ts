import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PeerTable, type PeerRecord } from './peer-table.js';

/** Real-shaped peer ids: 16 lowercase hex characters, as `derivePeerId`
 * produces and as the table's own boundary check requires
 * (identifiers.ts). */
const PEER_A = '00000000000000aa';
const PEER_B = '00000000000000bb';
const PEER_C = '00000000000000cc';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'beam-peers-'));
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

function record(
  overrides: Partial<PeerRecord> = {}
): Omit<PeerRecord, 'pairedAt' | 'revoked'> {
  return {
    peerId: PEER_A,
    label: 'workbox',
    publicKeyPem: 'pem-a',
    endpoints: [],
    ...overrides,
  };
}

describe('PeerTable input validation', () => {
  it('refuses a peerId that is not a derived id', () => {
    const table = new PeerTable(dir);
    expect(() => table.upsert(record({ peerId: '../escape' }))).toThrow(
      /16 lowercase hex/
    );
  });

  it('refuses a label rather than sanitising it', () => {
    const table = new PeerTable(dir);
    // A label reaches logs, the JSON lines other tools parse, and the
    // terminal. Silently rewriting one would also break the out-of-band
    // fingerprint comparison pairing asks the user to make, since the
    // label they compared is no longer the label stored.
    for (const label of [
      '',
      'a/b',
      'a\\b',
      'tmux:{session}',
      'bell\u0007',
      'x'.repeat(65),
    ]) {
      expect(() => table.upsert(record({ label }))).toThrow(/label must be/);
    }
    table.upsert(record({ label: 'work box-2.local' }));
    expect(table.get(PEER_A)?.label).toBe('work box-2.local');
    expect(() => table.rename(PEER_A, 'no/slashes')).toThrow(/label must be/);
  });
});

describe('PeerTable persistence', () => {
  it('persists peers.json with mode 0600', () => {
    const table = new PeerTable(dir);
    table.upsert(record());
    const path = join(dir, 'peers.json');
    const mode = statSync(path).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('a second PeerTable over the same dir sees peers written by the first', () => {
    new PeerTable(dir).upsert(record());
    const second = new PeerTable(dir);
    expect(second.get(PEER_A)?.label).toBe('workbox');
  });

  it('an interrupted write leaves the previous peers.json intact and parseable', () => {
    const table = new PeerTable(dir);
    table.upsert(record());
    const before = readFileSync(join(dir, 'peers.json'), 'utf8');

    // Simulate a crash between the temp-file write and the rename that
    // publishes it, without touching the real fs module's rename at all:
    // a second table, sharing the same directory, is given a renameSync
    // that always fails.
    const crashing = new PeerTable(dir, {
      fs: {
        mkdirSync,
        writeFileSync,
        renameSync: vi.fn(() => {
          throw new Error('simulated crash between write and rename');
        }),
      },
    });
    expect(() =>
      crashing.upsert(record({ peerId: PEER_B, label: 'laptop' }))
    ).toThrow();

    const after = readFileSync(join(dir, 'peers.json'), 'utf8');
    expect(after).toBe(before);
    expect(() => JSON.parse(after)).not.toThrow();
    expect(JSON.parse(after)).toHaveLength(1);
  });
});

describe('PeerTable operations', () => {
  it('upsert stamps pairedAt and defaults revoked to false', () => {
    const table = new PeerTable(dir, { now: () => 1000 });
    const stored = table.upsert(record());
    expect(stored.pairedAt).toBe(1000);
    expect(stored.revoked).toBe(false);
  });

  it('resolves a peer by id', () => {
    const table = new PeerTable(dir);
    table.upsert(record());
    expect(table.resolve(PEER_A)?.peerId).toBe(PEER_A);
  });

  it('resolves a peer by label', () => {
    const table = new PeerTable(dir);
    table.upsert(record());
    expect(table.resolve('workbox')?.peerId).toBe(PEER_A);
  });

  it('lists every stored peer', () => {
    const table = new PeerTable(dir);
    table.upsert(record());
    table.upsert(record({ peerId: PEER_B, label: 'laptop' }));
    expect(
      table
        .list()
        .map((p) => p.peerId)
        .sort()
    ).toEqual([PEER_A, PEER_B]);
  });

  it('resolves a label collision locally by appending -2, -3, ...', () => {
    const table = new PeerTable(dir);
    const a = table.upsert(record({ peerId: PEER_A, label: 'box' }));
    const b = table.upsert(record({ peerId: PEER_B, label: 'box' }));
    const c = table.upsert(record({ peerId: PEER_C, label: 'box' }));
    expect(a.label).toBe('box');
    expect(b.label).toBe('box-2');
    expect(c.label).toBe('box-3');
  });

  it('re-upserting the same peerId does not trigger its own collision suffix', () => {
    const table = new PeerTable(dir);
    table.upsert(record({ peerId: PEER_A, label: 'box' }));
    const again = table.upsert(
      record({ peerId: PEER_A, label: 'box', endpoints: ['https://x'] })
    );
    expect(again.label).toBe('box');
    expect(again.endpoints).toEqual(['https://x']);
  });

  it('rename keeps the peerId unchanged', () => {
    const table = new PeerTable(dir);
    table.upsert(record());
    const renamed = table.rename(PEER_A, 'renamed-box');
    expect(renamed.peerId).toBe(PEER_A);
    expect(renamed.label).toBe('renamed-box');
    expect(table.resolve('renamed-box')?.peerId).toBe(PEER_A);
  });

  it('revoke keeps the record but marks it revoked, stamped with when', () => {
    const table = new PeerTable(dir, { now: () => 5000 });
    table.upsert(record());
    table.revoke(PEER_A);
    const stored = table.get(PEER_A);
    expect(stored).toBeDefined();
    expect(stored?.revoked).toBe(true);
    expect(stored?.revokedAt).toBe(5000);
  });

  it('remove drops the record entirely', () => {
    const table = new PeerTable(dir);
    table.upsert(record());
    table.remove(PEER_A);
    expect(table.get(PEER_A)).toBeUndefined();
  });

  it('setEndpoints replaces the endpoint list', () => {
    const table = new PeerTable(dir);
    table.upsert(record());
    table.setEndpoints(PEER_A, ['https://a', 'https://b']);
    expect(table.get(PEER_A)?.endpoints).toEqual(['https://a', 'https://b']);
  });

  it('touch stamps lastSeenAt', () => {
    const table = new PeerTable(dir, { now: () => 500 });
    table.upsert(record());
    table.touch(PEER_A);
    expect(table.get(PEER_A)?.lastSeenAt).toBe(500);
  });

  it('touch accepts an explicit timestamp', () => {
    const table = new PeerTable(dir);
    table.upsert(record());
    table.touch(PEER_A, 12345);
    expect(table.get(PEER_A)?.lastSeenAt).toBe(12345);
  });
});
