import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PeerTable } from '@n10/beam';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolvePeer } from './peer-resolve.js';
import { RuntimeError } from './usage.js';

let dir: string;
let peers: PeerTable;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'beam-resolve-'));
  peers = new PeerTable(dir);
  peers.upsert({
    peerId: 'aaaaaaaaaaaaaaaa',
    label: 'workbox',
    publicKeyPem: 'key-a',
    endpoints: [],
  });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('resolvePeer', () => {
  it('resolves by label', () => {
    expect(resolvePeer(peers, 'workbox').peerId).toBe('aaaaaaaaaaaaaaaa');
  });

  it('resolves by peer id', () => {
    expect(resolvePeer(peers, 'aaaaaaaaaaaaaaaa').label).toBe('workbox');
  });

  it('fails clearly on an unknown name', () => {
    expect(() => resolvePeer(peers, 'nope')).toThrow(RuntimeError);
    expect(() => resolvePeer(peers, 'nope')).toThrow(/unknown peer "nope"/);
  });

  it("fails clearly when a string is both one peer's id and a different peer's label", () => {
    peers.upsert({
      peerId: 'aaaaaaaaaaaaaaaa'.replace(/a/g, () => 'b'),
      label: 'aaaaaaaaaaaaaaaa', // same text as the first peer's id
      publicKeyPem: 'key-b',
      endpoints: [],
    });
    expect(() => resolvePeer(peers, 'aaaaaaaaaaaaaaaa')).toThrow(RuntimeError);
    expect(() => resolvePeer(peers, 'aaaaaaaaaaaaaaaa')).toThrow(/ambiguous/);
  });
});
