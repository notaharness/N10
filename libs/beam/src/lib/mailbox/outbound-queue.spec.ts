import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Envelope } from './envelope.js';
import { OutboundQueue, type QuarantinedFile } from './outbound-queue.js';

/** Real-shaped peer ids: 16 lowercase hex characters, as `derivePeerId`
 * produces and as the queue's path boundary requires (identifiers.ts). */
const PEER_X = '00000000000000ec';
const PEER_Y = '00000000000000ed';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'beam-outq-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function envelope(seq: number, payload = `p${seq}`): Envelope {
  return {
    id: `id-${seq}`,
    from: 'sender',
    to: PEER_X,
    seq,
    topic: 't',
    payload,
    encoding: 'utf8',
    createdAt: Date.now(),
  };
}

describe('OutboundQueue', () => {
  it('enqueue writes a file a reader can list back, sorted into send order', () => {
    const queue = new OutboundQueue(dir);
    queue.enqueue(PEER_X, envelope(2));
    queue.enqueue(PEER_X, envelope(1));
    queue.enqueue(PEER_X, envelope(3));
    expect(queue.list(PEER_X).map((q) => q.envelope.seq)).toEqual([1, 2, 3]);
  });

  it('enqueue writes temp-then-rename, so the target file is never partial', () => {
    const queue = new OutboundQueue(dir);
    queue.enqueue(PEER_X, envelope(1));
    const path = join(dir, 'mailbox', 'out', PEER_X, '0000000001.json');
    const raw = readFileSync(path, 'utf8');
    expect(() => JSON.parse(raw)).not.toThrow();
    expect(raw.endsWith('.tmp')).toBe(false);
  });

  it('enqueue refuses to overwrite an existing queued message for the same seq (D2)', () => {
    const queue = new OutboundQueue(dir);
    queue.enqueue(PEER_X, envelope(1, 'first'));
    expect(() => queue.enqueue(PEER_X, envelope(1, 'clobber'))).toThrow();
    // The original, still-undelivered message survives untouched.
    expect(queue.list(PEER_X).map((q) => q.envelope.payload)).toEqual([
      'first',
    ]);
  });

  it('a refused enqueue leaves neither the target nor a temp file behind', () => {
    const queue = new OutboundQueue(dir);
    queue.enqueue(PEER_X, envelope(1, 'first'));
    const peerDir = join(dir, 'mailbox', 'out', PEER_X);
    expect(() => queue.enqueue(PEER_X, envelope(1, 'clobber'))).toThrow();
    // The target is created by linking the temp file, which fails when the
    // destination exists — a rename would have replaced it silently, and
    // the pre-check alone cannot close the window between the check and
    // the write. Nothing is left lying around either way.
    expect(readdirSync(peerDir)).toEqual(['0000000001.json']);
    expect(
      JSON.parse(readFileSync(join(peerDir, '0000000001.json'), 'utf8'))
    ).toMatchObject({ payload: 'first' });
  });

  it('isFull reports a peer at its depth or byte bound', () => {
    const shallow = new OutboundQueue(dir, { limits: { maxDepth: 2 } });
    expect(shallow.isFull(PEER_X)).toBe(false);
    shallow.enqueue(PEER_X, envelope(1));
    shallow.enqueue(PEER_X, envelope(2));
    expect(shallow.isFull(PEER_X)).toBe(true);
    // Another peer's queue is its own.
    expect(shallow.isFull(PEER_Y)).toBe(false);

    const small = new OutboundQueue(dir, { limits: { maxBytes: 10 } });
    expect(small.isFull(PEER_X)).toBe(true);
    expect(small.isFull(PEER_Y)).toBe(false);
  });

  it('reaps a leftover .tmp file at startup, without touching real queue files (D5)', () => {
    const peerDir = join(dir, 'mailbox', 'out', PEER_X);
    mkdirSync(peerDir, { recursive: true });
    const staleTmp = join(peerDir, '0000000001.json.12345.tmp');
    writeFileSync(staleTmp, '{"orphaned": true}');
    writeFileSync(
      join(peerDir, '0000000002.json'),
      JSON.stringify(envelope(2))
    );

    new OutboundQueue(dir); // Construction alone must reap it.

    expect(existsSync(staleTmp)).toBe(false);
    expect(
      new OutboundQueue(dir).list(PEER_X).map((q) => q.envelope.seq)
    ).toEqual([2]);
  });

  it('remove unlinks the file; a second remove is a harmless no-op', () => {
    const queue = new OutboundQueue(dir);
    queue.enqueue(PEER_X, envelope(1));
    queue.remove(PEER_X, '0000000001.json');
    expect(queue.list(PEER_X)).toHaveLength(0);
    expect(() => queue.remove(PEER_X, '0000000001.json')).not.toThrow();
  });

  it('depth() matches list().length and 0 for an unknown peer', () => {
    const queue = new OutboundQueue(dir);
    expect(queue.depth(PEER_Y)).toBe(0);
    queue.enqueue(PEER_X, envelope(1));
    queue.enqueue(PEER_X, envelope(2));
    expect(queue.depth(PEER_X)).toBe(2);
  });

  it('refuses a peerId that is not a derived id, rather than joining it into a path', () => {
    const queue = new OutboundQueue(dir);
    // Every mailbox path segment is a derived id today, which is why no
    // traversal is reachable; the check is what keeps that true.
    expect(() => queue.enqueue('../../escape', envelope(1))).toThrow(
      /16 lowercase hex/
    );
    expect(() => queue.depth('NOTHEX')).toThrow(/16 lowercase hex/);
  });

  it('quarantines an unparseable file, and it does not appear in list() again', () => {
    const quarantined: QuarantinedFile[] = [];
    const queue = new OutboundQueue(dir, {
      onQuarantine: (info) => quarantined.push(info),
    });
    queue.enqueue(PEER_X, envelope(1));
    const peerDir = join(dir, 'mailbox', 'out', PEER_X);
    writeFileSync(join(peerDir, '0000000002.json'), 'not json at all {{{');
    queue.enqueue(PEER_X, envelope(3));

    const listed = queue.list(PEER_X);
    expect(listed.map((q) => q.envelope.seq)).toEqual([1, 3]);
    expect(quarantined).toHaveLength(1);
    expect(quarantined[0]?.fileName).toBe('0000000002.json');

    // A second list() must not re-report the same file as newly quarantined.
    queue.list(PEER_X);
    expect(quarantined).toHaveLength(1);
  });

  it('quarantines a well-formed JSON value that is not an Envelope', () => {
    const quarantined: QuarantinedFile[] = [];
    const queue = new OutboundQueue(dir, {
      onQuarantine: (info) => quarantined.push(info),
    });
    const peerDir = join(dir, 'mailbox', 'out', PEER_X);
    mkdirSync(peerDir, { recursive: true });
    writeFileSync(
      join(peerDir, '0000000001.json'),
      JSON.stringify({ not: 'an envelope' })
    );
    expect(queue.list(PEER_X)).toHaveLength(0);
    expect(quarantined).toHaveLength(1);
  });

  it('quarantined() lists what was lost, with its reason, durably (D1)', () => {
    const queue = new OutboundQueue(dir);
    queue.enqueue(PEER_X, envelope(1));
    const peerDir = join(dir, 'mailbox', 'out', PEER_X);
    writeFileSync(join(peerDir, '0000000002.json'), 'not json at all {{{');
    queue.list(PEER_X); // Discovers and quarantines it.

    const listed = queue.quarantined(PEER_X);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      peerId: PEER_X,
      fileName: '0000000002.json',
    });
    expect(listed[0]?.reason).toContain('unparseable JSON');

    // Durable across a fresh instance — not only the transient event.
    expect(new OutboundQueue(dir).quarantined(PEER_X)).toEqual(listed);
  });

  it('peerIds() lists every peer with a queue directory', () => {
    const queue = new OutboundQueue(dir);
    queue.enqueue(PEER_X, envelope(1));
    queue.enqueue(PEER_Y, envelope(1));
    expect(queue.peerIds().sort()).toEqual([PEER_X, PEER_Y].sort());
  });
});
