import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ConnectionRegistry,
  EXEC_CHANNEL_STDOUT,
  Host,
  PeerTable,
  StreamRegistry,
  createExecStreamHandler,
  loadOrCreateIdentity,
  pair,
} from '@n10/beam';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runExec, writeChannelOutput } from './exec.js';
import {
  makeFakeIo,
  makeFakeIoWithBeamDir,
  type FakeIo,
} from '../test-support/fake-io.js';

let io: FakeIo;
let beamDir: string;
let remoteDir: string;
let host: Host;

beforeEach(async () => {
  ({ io, beamDir } = makeFakeIoWithBeamDir());
  remoteDir = mkdtempSync(join(tmpdir(), 'beam-exec-remote-'));

  const remoteIdentity = loadOrCreateIdentity(remoteDir, {
    hostname: () => 'remote',
  });
  const remotePeers = new PeerTable(remoteDir);
  const registry = new StreamRegistry();
  registry.register('exec', createExecStreamHandler());
  host = new Host({
    identity: remoteIdentity,
    peers: remotePeers,
    registry,
    connections: new ConnectionRegistry(),
    port: 0,
  });
  await host.listen();

  const localIdentity = loadOrCreateIdentity(beamDir, {
    hostname: () => 'local',
  });
  const localPeers = new PeerTable(beamDir);
  const { url } = host.issuePairingUrl();
  await pair(url, localPeers, { identity: localIdentity });
  // The stored peer's endpoint is what `beam exec` dials — set it to where
  // this test's host actually bound, since pairing over loopback advertises
  // nothing by default.
  localPeers.setEndpoints(remoteIdentity.peerId, [host.baseUrl]);
});

afterEach(async () => {
  await host.close();
  rmSync(beamDir, { recursive: true, force: true });
  rmSync(remoteDir, { recursive: true, force: true });
});

describe('beam exec', () => {
  it('propagates the remote exit code as its own', async () => {
    const code = await runExec(['remote', '--', 'sh', '-c', 'exit 7'], io);
    expect(code).toBe(7);
  });

  it('keeps stdout and stderr separate', async () => {
    const code = await runExec(
      ['remote', '--', 'sh', '-c', 'echo out-line; echo err-line 1>&2'],
      io
    );
    expect(code).toBe(0);
    expect(io.stdoutText()).toContain('out-line');
    expect(io.stdoutText()).not.toContain('err-line');
    expect(io.stderrText()).toContain('err-line');
    expect(io.stderrText()).not.toContain('out-line');
  });

  it('forwards stdin, including more than 64 KiB of it across multiple chunks', async () => {
    // Real stdin arrives as many chunks, not one — push it that way rather
    // than in a single 70 KB call, which would never exercise multi-chunk
    // forwarding even if that path were broken.
    const chunk = 'x'.repeat(10_000);
    const chunkCount = 7; // 70,000 bytes total, seven separate pushes.
    const promise = runExec(['remote', '--', 'wc', '-c'], io);
    for (let i = 0; i < chunkCount; i += 1) io.stdin.push(chunk);
    io.stdin.end();
    const code = await promise;
    expect(code).toBe(0);
    expect(io.stdoutText().trim()).toBe(String(chunk.length * chunkCount));
  });
});

describe('writeChannelOutput', () => {
  it('writes raw bytes rather than decoding each chunk, so a multibyte character split across a chunk boundary survives', () => {
    const io = makeFakeIo();
    // '€' (U+20AC) is the 3-byte UTF-8 sequence E2 82 AC. Split it after the
    // first byte, the way a real 64 KiB pipe read could split any
    // multibyte character that happens to land on its boundary.
    const euroSign = Buffer.from('€', 'utf8');
    const first = euroSign.subarray(0, 1);
    const second = euroSign.subarray(1);
    writeChannelOutput(io, EXEC_CHANNEL_STDOUT, first);
    writeChannelOutput(io, EXEC_CHANNEL_STDOUT, second);
    expect(io.stdoutText()).toBe('€');
  });
});
