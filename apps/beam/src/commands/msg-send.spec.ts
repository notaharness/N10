import { rmSync } from 'node:fs';
import { PeerTable } from '@n10/beam';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMsgSend } from './msg-send.js';
import { run } from '../run.js';
import { makeFakeIoWithBeamDir, type FakeIo } from '../test-support/fake-io.js';

let io: FakeIo;
let beamDir: string;

beforeEach(() => {
  ({ io, beamDir } = makeFakeIoWithBeamDir());
});

afterEach(() => {
  rmSync(beamDir, { recursive: true, force: true });
});

describe('beam msg send', () => {
  it('to a disconnected peer exits 0, is durable, and tells the caller not to resend it', async () => {
    const peers = new PeerTable(beamDir);
    peers.upsert({
      peerId: 'aaaaaaaaaaaaaaaa',
      label: 'workbox',
      publicKeyPem: 'key-a',
      endpoints: [], // never dialable — the disconnected case
    });

    const code = await runMsgSend(['workbox', '--message', 'hello'], io);
    expect(code).toBe(0);
    const text = io.stdoutText();
    expect(text).toContain('queued for workbox');
    expect(text).toMatch(/not connected/);
    expect(text).toMatch(/do not send it again/i);
  });

  it('to an unknown peer exits 1 and names the cause', async () => {
    const code = await runMsgSend(['nobody', '--message', 'hello'], io);
    expect(code).toBe(1);
    expect(io.stderrText()).toContain('unknown peer');
  });

  it('to a revoked peer exits 1 and names the cause', async () => {
    const peers = new PeerTable(beamDir);
    peers.upsert({
      peerId: 'aaaaaaaaaaaaaaaa',
      label: 'workbox',
      publicKeyPem: 'key-a',
      endpoints: [],
    });
    peers.revoke('aaaaaaaaaaaaaaaa');

    const code = await runMsgSend(['workbox', '--message', 'hi'], io);
    expect(code).toBe(1);
    expect(io.stderrText()).toContain('revoked');
  });

  it('--json prints exactly the local-IPC send outcome object, one value, nothing else', async () => {
    const peers = new PeerTable(beamDir);
    peers.upsert({
      peerId: 'aaaaaaaaaaaaaaaa',
      label: 'workbox',
      publicKeyPem: 'key-a',
      endpoints: [],
    });

    const code = await runMsgSend(
      ['workbox', '--message', 'hello', '--json'],
      io
    );
    expect(code).toBe(0);
    const lines = io.stdoutText().trimEnd().split('\n');
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0] as string) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      status: 'queued',
      to: 'aaaaaaaaaaaaaaaa',
      label: 'workbox',
    });
    expect(typeof parsed['queueDepth']).toBe('number');
    expect(typeof parsed['reason']).toBe('string');
  });

  it('--json on an unknown peer still prints exactly one parseable rejected object, echoing the requested name', async () => {
    const code = await runMsgSend(['nobody', '--message', 'hi', '--json'], io);
    expect(code).toBe(1);
    const parsed = JSON.parse(io.stdoutText().trimEnd()) as Record<
      string,
      unknown
    >;
    // D11/D9: a rejection must still say who it was for. `label` cannot be
    // resolved for an unknown peer, so only `to` (echoing what was asked
    // for) is guaranteed here.
    expect(parsed).toEqual({
      status: 'rejected',
      reason: 'unknown-peer',
      to: 'nobody',
    });
  });

  it('--json on a revoked peer resolves both to and label', async () => {
    const peers = new PeerTable(beamDir);
    peers.upsert({
      peerId: 'aaaaaaaaaaaaaaaa',
      label: 'workbox',
      publicKeyPem: 'key-a',
      endpoints: [],
    });
    peers.revoke('aaaaaaaaaaaaaaaa');

    const code = await runMsgSend(['workbox', '--message', 'hi', '--json'], io);
    expect(code).toBe(1);
    const parsed = JSON.parse(io.stdoutText().trimEnd()) as Record<
      string,
      unknown
    >;
    expect(parsed).toEqual({
      status: 'rejected',
      reason: 'revoked-peer',
      to: 'aaaaaaaaaaaaaaaa',
      label: 'workbox',
    });
  });

  it('with no --message and a TTY attached is a usage error, not a hang', async () => {
    const peers = new PeerTable(beamDir);
    peers.upsert({
      peerId: 'aaaaaaaaaaaaaaaa',
      label: 'workbox',
      publicKeyPem: 'key-a',
      endpoints: [],
    });
    io.stdin.isTTY = true;

    // Through run(), not runMsgSend() directly: a UsageError is a thrown
    // exception at this layer, and run() is what converts it to exit 2 —
    // the same reason exit-2 behaviour is tested through run() elsewhere
    // (run.spec.ts).
    const code = await run(['msg', 'send', 'workbox'], io);
    expect(code).toBe(2);
    expect(io.stderrText()).toContain('usage:');
  });

  it("refuses a name that is one peer's id and a different peer's label", async () => {
    const peers = new PeerTable(beamDir);
    peers.upsert({
      peerId: 'aaaaaaaaaaaaaaaa',
      label: 'workbox',
      publicKeyPem: 'key-a',
      endpoints: [],
    });
    peers.upsert({
      peerId: 'bbbbbbbbbbbbbbbb',
      label: 'aaaaaaaaaaaaaaaa', // same text as the first peer's id
      publicKeyPem: 'key-b',
      endpoints: [],
    });

    // Through run(), which is what turns the RuntimeError into exit 1.
    // Preferring the id match silently would send this to whichever peer
    // the library happened to pick, and say it had delivered it.
    const code = await run(
      ['msg', 'send', 'aaaaaaaaaaaaaaaa', '--message', 'hi'],
      io
    );
    expect(code).toBe(1);
    expect(io.stderrText()).toContain('ambiguous');
    expect(io.stdoutText()).toBe('');
  });

  it('reads the payload from stdin when --message is "-"', async () => {
    const peers = new PeerTable(beamDir);
    peers.upsert({
      peerId: 'aaaaaaaaaaaaaaaa',
      label: 'workbox',
      publicKeyPem: 'key-a',
      endpoints: [],
    });
    const promise = runMsgSend(['workbox', '--message', '-'], io);
    io.stdin.push('from stdin');
    io.stdin.end();
    const code = await promise;
    expect(code).toBe(0);
    expect(io.stdoutText()).toContain('queued for workbox');
  });
});
