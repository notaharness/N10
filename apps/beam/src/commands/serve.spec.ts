import { createServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadOrCreateIdentity } from '@n10/beam';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runServe } from './serve.js';
import { makeFakeIoWithBeamDir, type FakeIo } from '../test-support/fake-io.js';
import type { CommandOutcome, CommandRunner } from '../tailscale.js';
import { RuntimeError, UsageError } from '../usage.js';

let io: FakeIo;
let beamDir: string;
let controller: AbortController;
/** Cleared by a test that leaves no node running — one whose command threw
 * before installing a shutdown handler, or one that already shut down. Both
 * would otherwise wait forever below for an `io.exit` that never comes. */
let pendingShutdown: boolean;

beforeEach(() => {
  ({ io, beamDir } = makeFakeIoWithBeamDir());
  controller = new AbortController();
  io.signal = controller.signal;
  pendingShutdown = true;
});

afterEach(async () => {
  if (pendingShutdown) {
    const closed = new Promise<void>((resolve) => {
      io.exit = () => resolve();
    });
    controller.abort();
    await closed;
  }
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

describe('beam serve --tailscale-serve', () => {
  const STATUS = JSON.stringify({
    BackendState: 'Running',
    CertDomains: ['doppa.tail3a5828.ts.net'],
    Self: { DNSName: 'doppa.tail3a5828.ts.net.' },
  });

  function okOutcome(stdout = ''): CommandOutcome {
    return { code: 0, stdout, stderr: '', timedOut: false };
  }

  /** Stands in for the `tailscale` binary, keyed on the first two argv
   * words after it, recording every call. Nothing is spawned, so these
   * cases run identically on a machine with no tailscale installed. */
  function fakeTailscale(
    overrides: Record<string, CommandOutcome> = {}
  ): CommandRunner & { argvs: string[][] } {
    const base: Record<string, CommandOutcome> = {
      'status --json': okOutcome(STATUS),
      'serve status': okOutcome('{}'),
      'serve --bg': okOutcome(),
      'serve --https=443': okOutcome(),
    };
    const argvs: string[][] = [];
    const run = (argv: string[]): Promise<CommandOutcome> => {
      argvs.push(argv);
      const key = argv.slice(1, 3).join(' ');
      const reply = overrides[key] ?? base[key];
      if (reply === undefined)
        throw new Error(`unscripted tailscale call: ${argv.join(' ')}`);
      return Promise.resolve(reply);
    };
    return Object.assign(run, { argvs });
  }

  /** The loopback address the node really bound, read back from the line
   * `serve` prints — the only handle a caller of `runServe` gets on it. */
  function boundBaseUrl(text: string): string {
    const match = /bound to (http:\/\/127\.0\.0\.1:\d+)/.exec(text);
    if (!match) throw new Error(`no bind line in output:\n${text}`);
    return match[1] as string;
  }

  /** A port nothing is listening on, so a second `serve` on it can prove
   * the first one released it. */
  async function freePort(): Promise<number> {
    const probe = createServer();
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const address = probe.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    return port;
  }

  it('prints a pairing URL on the MagicDNS name, not the loopback bind address', async () => {
    const runCommand = fakeTailscale();
    const code = await runServe(['--port', '0', '--tailscale-serve'], io, {
      runCommand,
    });

    expect(code).toBe(0);
    const lines = io.stdoutLines();
    expect(lines[lines.length - 1]).toMatch(
      /^https:\/\/doppa\.tail3a5828\.ts\.net\/pair#token=[\w-]{16}/
    );
    expect(io.stdoutText()).toContain(
      'published over tailscale serve: https://doppa.tail3a5828.ts.net -> http://127.0.0.1:'
    );
    // Still bound on loopback: tailscale is what faces the tailnet, so the
    // beyond-loopback warning would be wrong here.
    expect(io.stdoutText()).toContain('bound to http://127.0.0.1:');
    expect(io.stdoutText()).not.toMatch(/warning/i);
  });

  it('points the serve mapping at the port the node really bound', async () => {
    const runCommand = fakeTailscale();
    await runServe(['--port', '0', '--tailscale-serve'], io, { runCommand });

    const base = boundBaseUrl(io.stdoutText());
    expect(base).not.toMatch(/:0$/);
    expect(runCommand.argvs).toContainEqual([
      'tailscale',
      'serve',
      '--bg',
      '--https=443',
      base,
    ]);
  });

  it('hands a pairing peer the tailnet origin as the endpoint it stores', async () => {
    const runCommand = fakeTailscale();
    await runServe(['--port', '0', '--tailscale-serve'], io, { runCommand });

    // Spend the printed token against the node for real: `endpoints` in the
    // pair response is exactly what the far side writes into its peer table
    // and dials on every later reconnect.
    const printed = io.stdoutLines().at(-1) as string;
    const caller = mkdtempSync(join(tmpdir(), 'beam-cli-pairer-'));
    try {
      const response = await fetch(`${boundBaseUrl(io.stdoutText())}/pair`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          token: printed.split('#token=')[1],
          publicKeyPem: loadOrCreateIdentity(caller).publicKeyPem,
          label: 'pairer',
        }),
      });
      expect(response.status).toBe(201);
      const body = (await response.json()) as { endpoints: string[] };
      expect(body.endpoints).toEqual(['https://doppa.tail3a5828.ts.net']);
    } finally {
      rmSync(caller, { recursive: true, force: true });
    }
  });

  it('removes the mapping on shutdown', async () => {
    const runCommand = fakeTailscale();
    await runServe(['--port', '0', '--tailscale-serve'], io, { runCommand });

    const closed = new Promise<void>((resolve) => {
      io.exit = () => resolve();
    });
    controller.abort();
    await closed;
    pendingShutdown = false;

    expect(runCommand.argvs).toContainEqual([
      'tailscale',
      'serve',
      '--https=443',
      'off',
    ]);
  });

  it('refuses --hostname alongside it, before starting a node or calling tailscale', async () => {
    pendingShutdown = false;
    const runCommand = fakeTailscale();

    await expect(
      runServe(
        ['--port', '0', '--tailscale-serve', '--hostname', '0.0.0.0'],
        io,
        { runCommand }
      )
    ).rejects.toThrow(UsageError);
    expect(runCommand.argvs).toEqual([]);
    expect(io.stdoutText()).toBe('');
  });

  it('releases the port and prints no pairing URL when the proxy cannot come up', async () => {
    const port = await freePort();
    const failing = fakeTailscale({
      'status --json': okOutcome(
        JSON.stringify({ BackendState: 'NeedsLogin' })
      ),
    });

    const thrown = await runServe(
      ['--port', String(port), '--tailscale-serve'],
      io,
      { runCommand: failing }
    ).then(
      () => null,
      (caught: unknown) => caught
    );

    expect(thrown).toBeInstanceOf(RuntimeError);
    expect((thrown as RuntimeError).message).toContain(
      'not connected (state: NeedsLogin)'
    );
    expect(io.stdoutText()).not.toContain('/pair#token=');

    // The node started before tailscale was reached is closed again, so the
    // same port is free for the next run rather than held by a dead node.
    const code = await runServe(
      ['--port', String(port), '--tailscale-serve'],
      io,
      { runCommand: fakeTailscale() }
    );
    expect(code).toBe(0);
  });
});
