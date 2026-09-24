import { homedir } from 'node:os';
import { app } from 'electron';
import { join } from 'node:path';
import { setLocalSessionEnv } from '@n10/core';
import { writeSessionBin } from '../session-bin.js';
import { BeamClient } from './client.js';
import { spawnOwnedDaemon } from './owned-daemon.js';
import { beamBinary, beamEnv, beamPaths } from './paths.js';

/** The app's beam client: it connects to the daemon at beam's own
 *  paths, or starts one there that it owns (decisions.md D15). */
export function appBeamClient(): BeamClient {
  const paths = beamPaths(process.env, homedir());
  return new BeamClient({
    socketPath: paths.socket,
    spawnDaemon: () => spawnOwnedDaemon(beamEnv(paths, process.env)),
    log: (message) => console.error(message),
  });
}

/** Puts `beam` and `n10` first on every local session's PATH, from a
 *  directory under `userData` (`session-bin.ts`), and gives sessions
 *  the beam paths the app uses. Without the directory, sessions keep
 *  the PATH they would have had. */
export function installSessionBin(userData: string): void {
  const dir = join(userData, 'bin');
  let beam: string | undefined;
  try {
    beam = beamBinary();
  } catch (err) {
    console.error('[desktop] no beam binary for this platform', err);
  }
  let pathDirs: string[] = [];
  try {
    writeSessionBin(dir, {
      runtime: process.execPath,
      shim: join(import.meta.dirname, 'n10-shim.js'),
      beam,
    });
    pathDirs = [dir];
  } catch (err) {
    console.error('[desktop] session bin', err);
  }
  setLocalSessionEnv({
    pathDirs,
    env: beamEnv(beamPaths(process.env, homedir()), process.env),
  });
}

/**
 * Runs `release` once on quit, then holds the quit until the daemon the
 * app started has stopped (D15), and exits. `app.exit`, because an
 * `app.quit` from here can land inside this quit and be ignored.
 */
export function quitAfterBeam(beam: BeamClient, release: () => void): void {
  let quitting = false;
  app.on('will-quit', (event) => {
    event.preventDefault();
    if (quitting) return;
    quitting = true;
    // A relaunch while this one waits on beam must win, not quit into it.
    app.releaseSingleInstanceLock();
    release();
    beam
      .shutdown()
      .catch((err: unknown) => console.error('[desktop] beam shutdown', err))
      .finally(() => app.exit());
  });
}
