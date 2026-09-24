import { chmodSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DaemonLauncher } from './launcher.js';
import type { DaemonExit, OwnedDaemon } from './owned-daemon.js';
import { FakeDaemon } from './test-support/fake-daemon.js';

let dir: string;
let socketPath: string;
let daemon: FakeDaemon | null;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'n10-beam-launcher-'));
  socketPath = join(dir, 'beam.sock');
  daemon = null;
});
afterEach(async () => {
  await daemon?.close();
  rmSync(dir, { recursive: true, force: true });
});

/** An owned daemon served by a FakeDaemon: it exits when stopped,
 *  unless `stubborn`. */
function ownedDaemon(opts: { stubborn?: boolean } = {}) {
  const log = { spawned: 0, stopped: false, killed: false };
  const spawn = (): OwnedDaemon => {
    log.spawned++;
    let exit!: (e: DaemonExit) => void;
    const exited = new Promise<DaemonExit>((resolve) => (exit = resolve));
    const started = FakeDaemon.start(socketPath).then((d) => (daemon = d));
    const end = () => {
      void started
        .then((d) => d.close())
        .then(() => exit({ code: 0, signal: null }));
    };
    return {
      exited,
      stop: () => {
        log.stopped = true;
        if (!opts.stubborn) setTimeout(end, 5);
      },
      kill: () => {
        log.killed = true;
        end();
      },
    };
  };
  return { log, spawn };
}

/** A spawn whose daemon exits at once with `exit`. */
function failingSpawn(exit: DaemonExit): () => OwnedDaemon {
  return () => ({
    exited: Promise.resolve(exit),
    stop: () => undefined,
    kill: () => undefined,
  });
}

describe('DaemonLauncher', () => {
  it('stops its own daemon through the child, never over the socket', async () => {
    const o = ownedDaemon();
    const launcher = new DaemonLauncher(socketPath, o.spawn, 50);
    await launcher.connect();
    const d = daemon!;
    await launcher.stop();
    expect(o.log.stopped).toBe(true);
    expect(d.requests('daemon.shutdown')).toHaveLength(0);
    expect(o.log.killed).toBe(false);
  });

  it('kills a daemon that outstays its grace', async () => {
    const o = ownedDaemon({ stubborn: true });
    const launcher = new DaemonLauncher(socketPath, o.spawn, 50);
    await launcher.connect();
    await launcher.stop();
    expect(o.log.killed).toBe(true);
  });

  it('starts nothing once stopped', async () => {
    const o = ownedDaemon();
    const launcher = new DaemonLauncher(socketPath, o.spawn, 50);
    await launcher.stop();
    await expect(launcher.connect()).rejects.toThrow();
    expect(o.log.spawned).toBe(0);
  });

  it('starts a daemon only when none is there, not when one refuses it', async () => {
    const locked = join(dir, 'locked');
    mkdirSync(locked);
    chmodSync(locked, 0o000);
    const o = ownedDaemon();
    const launcher = new DaemonLauncher(join(locked, 'beam.sock'), o.spawn);
    try {
      await expect(launcher.connect()).rejects.toThrow(/EACCES/);
    } finally {
      chmodSync(locked, 0o700);
    }
    expect(o.log.spawned).toBe(0);
  });

  it('fails with the daemon’s own last line when it exits 1', async () => {
    const launcher = new DaemonLauncher(
      socketPath,
      failingSpawn({ code: 1, signal: null, lastLine: 'fleet.json: bad' })
    );
    await expect(launcher.connect()).rejects.toThrow(
      'beam could not start: fleet.json: bad'
    );
  });

  it('waits for the winner when its daemon lost the start race', async () => {
    const launcher = new DaemonLauncher(
      socketPath,
      failingSpawn({
        code: 1,
        signal: null,
        lastLine: `beam: another daemon holds ${dir}`,
      })
    );
    const connecting = launcher.connect();
    await delay(150);
    daemon = await FakeDaemon.start(socketPath);
    const conn = await connecting;
    await expect(conn.request('status')).resolves.toEqual({});
    conn.close();
  });
});
