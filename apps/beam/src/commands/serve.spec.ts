import { rmSync } from 'node:fs';
import { loadOrCreateIdentity } from '@n10/beam';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runServe } from './serve.js';
import { makeFakeIoWithBeamDir, type FakeIo } from '../test-support/fake-io.js';

let io: FakeIo;
let beamDir: string;
let controller: AbortController;

beforeEach(() => {
  ({ io, beamDir } = makeFakeIoWithBeamDir());
  controller = new AbortController();
  io.signal = controller.signal;
});

afterEach(async () => {
  const closed = new Promise<void>((resolve) => {
    io.exit = () => resolve();
  });
  controller.abort();
  await closed;
  rmSync(beamDir, { recursive: true, force: true });
});

describe('beam serve', () => {
  it('binds loopback by default without warning, and prints the pairing URL last', async () => {
    const code = await runServe(['--port', '0'], io);
    expect(code).toBe(0);
    const text = io.stdoutText();
    expect(text).not.toMatch(/warning/i);
    expect(text).toContain('bound to http://127.0.0.1:');
    // The pairing URL is the last thing printed.
    const lines = io.stdoutLines();
    expect(lines[lines.length - 1]).toMatch(
      /^http:\/\/127\.0\.0\.1:\d+\/pair#token=/
    );
  });

  it('warns clearly when binding beyond loopback', async () => {
    const code = await runServe(['--port', '0', '--hostname', '0.0.0.0'], io);
    expect(code).toBe(0);
    const text = io.stdoutText();
    expect(text).toMatch(/warning/i);
    expect(text).toMatch(/gets a shell as this user/);
  });

  it('--no-pair omits the pairing URL', async () => {
    const code = await runServe(['--port', '0', '--no-pair'], io);
    expect(code).toBe(0);
    expect(io.stdoutText()).not.toContain('/pair#token=');
  });

  it('--label on an already-existing identity actually renames it, not just a note', async () => {
    // Seed an identity under a different label first, as if a node had
    // run here before with the default hostname-derived name.
    loadOrCreateIdentity(beamDir, { hostname: () => 'first-name' });

    const code = await runServe(['--port', '0', '--label', 'renamed'], io);
    expect(code).toBe(0);
    expect(io.stdoutText()).toContain('renamed (');
    expect(io.stderrText()).not.toMatch(/note:/);
    expect(loadOrCreateIdentity(beamDir).label).toBe('renamed');
  });
});
