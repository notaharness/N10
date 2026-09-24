import { join } from 'node:path';
import { utilityProcess } from 'electron';
import { beamBinary } from './paths.js';

/** How a daemon ended: its status and the last line it wrote to
 *  stderr, or `error` when it never ran. */
export interface DaemonExit {
  code: number | null;
  signal: string | null;
  lastLine?: string;
  error?: string;
}

/** A `beam daemon` this app started and stops on quit. */
export interface OwnedDaemon {
  /** Resolves once its worker has exited; never rejects. */
  readonly exited: Promise<DaemonExit>;
  /** Asks it to stop by closing its stdin (`--exit-with-parent`), which
   *  takes beam's graceful shutdown. */
  stop(): void;
  kill(): void;
}

/**
 * Starts `beam daemon` under a utility process (`beam-daemon-worker.ts`),
 * the same isolation tmux sessions get: a child forked straight from the
 * browser process inherits its descriptors, profile locks included.
 * `env` is added to the app's own environment.
 */
export function spawnOwnedDaemon(env: Record<string, string>): OwnedDaemon {
  const binary = beamBinary();
  const worker = utilityProcess.fork(
    join(import.meta.dirname, 'beam-daemon-worker.js'),
    [],
    { stdio: 'inherit', serviceName: 'n10 beam daemon' }
  );
  let ending: DaemonExit = { code: null, signal: null };
  worker.on('message', (m: { exited?: DaemonExit }) => {
    if (m.exited) ending = m.exited;
  });
  const exited = new Promise<DaemonExit>((resolve) => {
    worker.once('exit', () => resolve(ending));
  });
  worker.postMessage({
    binary,
    // Stops at EOF on stdin, so a crash of the app, whose worker holds
    // the pipe, ends it too (beam docs/07).
    args: ['daemon', '--exit-with-parent'],
    env,
  });
  return {
    exited,
    stop: () => worker.postMessage({ closeStdin: true }),
    kill: () => worker.postMessage({ kill: true }),
  };
}
