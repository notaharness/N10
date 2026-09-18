import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BeamNode } from './beam-node.js';
import type { PairConfirmResult } from '../host/contract-machines.js';

/**
 * Two real nodes on loopback, in temp `$BEAM_DIR`s — better evidence
 * than mocking the library, and the pattern libs/beam's own
 * `e2e.spec.ts` already uses. Probing runs on a very short interval so
 * "wait for the next tick" tests stay fast without faking timers around
 * real `setTimeout`-based fetches.
 */

let dirA: string;
let dirB: string;
let a: BeamNode;
let b: BeamNode;

beforeEach(() => {
  dirA = mkdtempSync(join(tmpdir(), 'beam-node-a-'));
  dirB = mkdtempSync(join(tmpdir(), 'beam-node-b-'));
  a = new BeamNode({
    beamDir: dirA,
    hostname: () => 'workbox',
    probeIntervalMs: 30,
    probeTimeoutMs: 2000,
  });
  b = new BeamNode({
    beamDir: dirB,
    hostname: () => 'laptop',
    probeIntervalMs: 30,
    probeTimeoutMs: 2000,
  });
});

afterEach(async () => {
  await a.dispose();
  await b.dispose();
  rmSync(dirA, { recursive: true, force: true });
  rmSync(dirB, { recursive: true, force: true });
});

async function waitFor(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('a fresh node', () => {
  it('lists only itself, connected, with no endpoints and not accepting', async () => {
    const machines = a.listMachines();
    expect(machines).toHaveLength(1);
    expect(machines[0]).toMatchObject({
      isLocal: true,
      state: 'connected',
      endpoints: [],
    });
    expect(a.getAcceptingStatus()).toMatchObject({
      accepting: false,
      boundAddress: null,
      pairingUrl: null,
    });
  });
});

describe('accepting connections', () => {
  it('does not listen until told to, and stops when told to', async () => {
    const before = a.getAcceptingStatus();
    expect(before.accepting).toBe(false);

    const started = await a.startAccepting();
    expect(started.accepting).toBe(true);
    expect(started.boundAddress).toMatch(/^127\.0\.0\.1:\d+$/);
    expect(started.pairingUrl).toContain('#token=');
    expect(started.pairingExpiresAt).not.toBeNull();

    const stopped = await a.stopAccepting();
    expect(stopped.accepting).toBe(false);
    expect(stopped.pairingUrl).toBeNull();
  });

  it('regenerating mints a different token than the one already issued', async () => {
    const first = await a.startAccepting();
    const second = a.regeneratePairingUrl();
    expect(second.pairingUrl).not.toBe(first.pairingUrl);
  });

  it('refuses to regenerate while not accepting', () => {
    expect(() => a.regeneratePairingUrl()).toThrow(/not accepting/);
  });
});

describe('previewPairing', () => {
  it('shows the label, fingerprint and endpoint without spending the token', async () => {
    const status = await a.startAccepting();
    const preview = await b.previewPairing(status.pairingUrl!);
    expect(preview.ok).toBe(true);
    if (!preview.ok) throw new Error('expected ok');
    expect(preview.preview.label).toBe('workbox');
    expect(preview.preview.peerId).toMatch(/^[0-9a-f]{16}$/);
    expect(preview.preview.endpoint).toBe(`http://${status.boundAddress}`);

    // Not spent: confirming afterward still works.
    const confirmed = await b.confirmPairing(status.pairingUrl!);
    expect(confirmed.ok).toBe(true);
  });

  it('reports an invalid URL as invalid-url, not a generic failure', async () => {
    const preview = await b.previewPairing('not a url at all');
    expect(preview).toMatchObject({
      ok: false,
      failure: { reason: 'invalid-url' },
    });
  });

  it('reports an unreachable host as unreachable', async () => {
    const preview = await b.previewPairing('http://127.0.0.1:1/pair#token=x');
    expect(preview).toMatchObject({
      ok: false,
      failure: { reason: 'unreachable' },
    });
  });
});

describe('confirmPairing', () => {
  it('stores the peer, immediately unknown, then reachable once probed', async () => {
    const status = await a.startAccepting();
    const result = await b.confirmPairing(status.pairingUrl!);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.machine.label).toBe('workbox');
    // No probe has run yet — must read as unknown, never unreachable.
    expect(result.machine.state).toBe('unknown');

    await waitFor(() => {
      const m = b
        .listMachines()
        .find((x) => x.peerId === result.machine.peerId);
      return m?.state === 'reachable';
    });
  });

  it('reports a spent token as invalid-token, and does not duplicate the peer', async () => {
    const status = await a.startAccepting();
    await b.confirmPairing(status.pairingUrl!);
    const second = await b.confirmPairing(status.pairingUrl!);
    expect(second).toMatchObject({
      ok: false,
      failure: { reason: 'invalid-token' },
    });
    expect(b.listMachines()).toHaveLength(2); // local + the one real peer
  });
});

describe('renameMachine', () => {
  it('renames the local row without touching its identity across calls', async () => {
    const before = a.listMachines()[0];
    const renamed = a.renameMachine(before.peerId, 'my-workbox');
    expect(renamed.label).toBe('my-workbox');
    expect(renamed.peerId).toBe(before.peerId);
    expect(a.listMachines()[0].label).toBe('my-workbox');
  });

  it('renames a peer without changing its id', async () => {
    const status = await a.startAccepting();
    const { machine } = await must(b.confirmPairing(status.pairingUrl!));
    const renamed = b.renameMachine(machine.peerId, 'work-box-2');
    expect(renamed.peerId).toBe(machine.peerId);
    expect(renamed.label).toBe('work-box-2');
  });
});

describe('revoke vs forget', () => {
  it('revoke keeps the record, marked revoked; forget removes it entirely', async () => {
    const status = await a.startAccepting();
    const { machine } = await must(b.confirmPairing(status.pairingUrl!));

    const revoked = b.revokeMachine(machine.peerId);
    expect(revoked.state).toBe('revoked');
    expect(b.listMachines().some((m) => m.peerId === machine.peerId)).toBe(
      true
    );

    b.forgetMachine(machine.peerId);
    expect(b.listMachines().some((m) => m.peerId === machine.peerId)).toBe(
      false
    );
  });
});

describe('dispose', () => {
  it('stops accepting and closes connections', async () => {
    const status = await a.startAccepting();
    await b.confirmPairing(status.pairingUrl!);
    await a.dispose();
    expect(a.getAcceptingStatus().accepting).toBe(false);
    // Disposing twice is a no-op, not a throw.
    await expect(a.dispose()).resolves.toBeUndefined();
  });
});

async function must(
  promise: Promise<PairConfirmResult>
): Promise<Extract<PairConfirmResult, { ok: true }>> {
  const result = await promise;
  if (!result.ok) throw new Error('expected ok result');
  return result;
}

/**
 * D5's MachineExecutor and D4's remote pty transport, exercised over
 * two real nodes on loopback rather than mocked — the same standard
 * the rest of this file holds itself to.
 */
describe('remote-machine ops (execOn, ptyOpen/ptyWrite/ptyResize/ptyClose)', () => {
  it('execOn runs argv on the peer and resolves with its stdout and exit code', async () => {
    const status = await a.startAccepting();
    const { machine } = await must(b.confirmPairing(status.pairingUrl!));
    const result = await b.remote.execOn(machine.peerId, [
      'node',
      '-e',
      'process.stdout.write("hi"); process.exit(0)',
    ]);
    expect(result).toEqual({ stdout: 'hi', stderr: '', code: 0 });
  });

  it('execOn forwards stdin and reports a nonzero exit code', async () => {
    const status = await a.startAccepting();
    const { machine } = await must(b.confirmPairing(status.pairingUrl!));
    const result = await b.remote.execOn(
      machine.peerId,
      [
        'node',
        '-e',
        'process.stdin.on("data", d => process.stdout.write(d)); process.stdin.on("end", () => process.exit(3))',
      ],
      { stdin: 'echoed' }
    );
    expect(result.stdout).toBe('echoed');
    expect(result.code).toBe(3);
  });

  it('execOn dials a peer with no live connection yet, using its known endpoint', async () => {
    const status = await a.startAccepting();
    const { machine } = await must(b.confirmPairing(status.pairingUrl!));
    // Force a fresh dial rather than reusing the connection pairing left open.
    await b.dispose();
    b = new BeamNode({ beamDir: dirB, hostname: () => 'laptop' });
    await must(b.confirmPairing((await a.startAccepting()).pairingUrl!));
    const result = await b.remote.execOn(machine.peerId, [
      'node',
      '-e',
      'process.exit(0)',
    ]);
    expect(result.code).toBe(0);
  });

  it('ptyOpen streams data both ways and ptyClose ends the stream without the peer node dying', async () => {
    const status = await a.startAccepting();
    const { machine } = await must(b.confirmPairing(status.pairingUrl!));
    const events: { kind: string; streamId: string; data?: string }[] = [];
    const off = b.remote.onStreamEvent((event) => events.push(event));
    const { streamId } = await b.remote.ptyOpen(machine.peerId, {
      argv: ['cat'],
      cols: 80,
      rows: 24,
    });
    b.remote.ptyWrite(streamId, 'echo me\n');
    await waitFor(() =>
      events.some((e) => e.kind === 'data' && e.data?.includes('echo me'))
    );
    b.remote.ptyResize(streamId, 100, 40);
    b.remote.ptyClose(streamId);
    await waitFor(() =>
      events.some((e) => e.kind === 'closed' && e.streamId === streamId)
    );
    off();
    // The remote node itself is unaffected: it can still be asked to run something else.
    const result = await b.remote.execOn(machine.peerId, [
      'node',
      '-e',
      'process.exit(0)',
    ]);
    expect(result.code).toBe(0);
  });
});
