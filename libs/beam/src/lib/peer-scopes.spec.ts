import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  grantedScopes,
  narrowScopes,
  normalizeScopes,
  parseScopeRefusal,
  scopeForStream,
  scopeRefusalReason,
  STREAM_SCOPES,
} from './peer-scopes.js';
import { PeerTable } from './peer-table.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'beam-scopes-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('scopeForStream', () => {
  it('maps every stream kind, and treats pty:<program> as pty', () => {
    expect(scopeForStream('pty')).toBe('pty');
    expect(scopeForStream('pty:bash')).toBe('pty');
    expect(scopeForStream('exec')).toBe('exec');
    expect(scopeForStream('msg')).toBe('msg');
  });

  it('governs nothing it does not recognise, leaving it to the registry', () => {
    expect(scopeForStream('rtc')).toBeUndefined();
    expect(scopeForStream('')).toBeUndefined();
    expect(scopeForStream(':pty')).toBeUndefined();
  });
});

describe('normalizeScopes', () => {
  it('reports an absent grant as absent, not as empty', () => {
    // The whole legacy story rests on this distinction: a record with no
    // field is unconstrained, a record with an empty array grants nothing.
    expect(normalizeScopes(undefined)).toBeUndefined();
    expect(normalizeScopes([])).toEqual([]);
  });

  it('keeps only names this version knows, in canonical order', () => {
    expect(normalizeScopes(['msg', 'pty'])).toEqual(['pty', 'msg']);
    expect(normalizeScopes(['exec', 'sudo', 42, null])).toEqual(['exec']);
  });

  it('grants nothing for a present value that is not an array', () => {
    // peers.json is loaded with a bare JSON.parse, so any of these can
    // reach here. A field somebody wrote and this code cannot read is not
    // a reason to hand over a shell.
    expect(normalizeScopes('pty')).toEqual([]);
    expect(normalizeScopes(null)).toEqual([]);
    expect(normalizeScopes(7)).toEqual([]);
    expect(normalizeScopes({ pty: true })).toEqual([]);
  });
});

describe('grantedScopes', () => {
  it('reads a record with no scopes field as all three', () => {
    expect(grantedScopes({})).toEqual([...STREAM_SCOPES]);
    expect(grantedScopes({ scopes: undefined })).toEqual([...STREAM_SCOPES]);
  });

  it('reads a stored grant back exactly', () => {
    expect(grantedScopes({ scopes: ['msg'] })).toEqual(['msg']);
  });

  it('grants nothing for a peer that is no longer in the table', () => {
    expect(grantedScopes(undefined)).toEqual([]);
  });
});

describe('narrowScopes', () => {
  it('leaves an unconstrained record unconstrained when nothing is offered', () => {
    expect(narrowScopes(undefined, undefined)).toBeUndefined();
  });

  it('narrows an unconstrained record to what the pairing offered', () => {
    expect(narrowScopes(undefined, ['msg'])).toEqual(['msg']);
  });

  it('refuses to widen: a broader offer cannot restore a narrowed grant', () => {
    expect(narrowScopes(['msg'], ['pty', 'exec', 'msg'])).toEqual(['msg']);
    expect(narrowScopes(['msg'], undefined)).toEqual(['msg']);
    expect(narrowScopes([], ['pty'])).toEqual([]);
  });

  it('intersects two partial grants', () => {
    expect(narrowScopes(['pty', 'msg'], ['msg', 'exec'])).toEqual(['msg']);
  });
});

describe('scope refusal reasons', () => {
  it('round-trips the scope it names', () => {
    expect(parseScopeRefusal(scopeRefusalReason('pty'))).toBe('pty');
  });

  it('does not read any other close reason as a refusal', () => {
    // These are the close reasons a transport failure or an ordinary end
    // of stream produces (connection.ts, muxer.ts). None may be mistaken
    // for "you are not allowed", or a caller would stop retrying a host
    // that is merely unreachable.
    for (const reason of [
      undefined,
      'connection closed',
      'connection lost: no pong within 10000ms',
      'closed locally',
      'terminated locally',
      'peer revoked',
      'unsupported stream: pty',
      'scope-not-granted:',
      'scope-not-granted:sudo',
    ]) {
      expect(parseScopeRefusal(reason)).toBeUndefined();
    }
  });
});

describe('PeerTable storage', () => {
  it('stores a grant and narrows it on a re-pair, never widening', () => {
    const peers = new PeerTable(dir);
    peers.upsert({
      peerId: 'aaaaaaaaaaaaaaaa',
      label: 'worker',
      publicKeyPem: 'key-a',
      endpoints: [],
      scopes: ['msg'],
    });
    expect(peers.get('aaaaaaaaaaaaaaaa')?.scopes).toEqual(['msg']);

    peers.upsert({
      peerId: 'aaaaaaaaaaaaaaaa',
      label: 'worker',
      publicKeyPem: 'key-a',
      endpoints: [],
      scopes: ['pty', 'exec', 'msg'],
    });
    expect(peers.get('aaaaaaaaaaaaaaaa')?.scopes).toEqual(['msg']);
  });

  it('keeps a record with no scopes field field-less, and reads it as all', () => {
    const peers = new PeerTable(dir);
    peers.upsert({
      peerId: 'bbbbbbbbbbbbbbbb',
      label: 'legacy',
      publicKeyPem: 'key-b',
      endpoints: [],
    });
    const stored = peers.get('bbbbbbbbbbbbbbbb');
    expect(stored && 'scopes' in stored).toBe(false);
    expect(grantedScopes(stored)).toEqual([...STREAM_SCOPES]);
  });

  it('survives a reload: a grant is on disk, not in this instance', () => {
    const peers = new PeerTable(dir);
    peers.upsert({
      peerId: 'cccccccccccccccc',
      label: 'worker',
      publicKeyPem: 'key-c',
      endpoints: [],
      scopes: ['msg'],
    });
    expect(grantedScopes(new PeerTable(dir).get('cccccccccccccccc'))).toEqual([
      'msg',
    ]);
  });
});
