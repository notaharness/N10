import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

/** Where beam keeps this machine's identity and its control socket. */
export interface BeamPaths {
  configDir: string;
  socket: string;
}

/**
 * beam's paths, found as beam finds them (beam docs/02, docs/06): the
 * directory is `$BEAM_CONFIG_DIR`, `$XDG_CONFIG_HOME/beam` or
 * `~/.config/beam`; the socket is `$BEAM_SOCKET`, else `run/beam.sock`
 * in it. Both absolute, as beam requires of the daemon's.
 */
export function beamPaths(env: NodeJS.ProcessEnv, home: string): BeamPaths {
  const configDir = resolve(
    env.BEAM_CONFIG_DIR ||
      join(env.XDG_CONFIG_HOME || join(home, '.config'), 'beam')
  );
  const socket = env.BEAM_SOCKET
    ? resolve(env.BEAM_SOCKET)
    : join(configDir, 'run', 'beam.sock');
  return { configDir, socket };
}

/** The variables that make a process the app starts find these same
 *  paths, whatever environment it would otherwise read them from: an
 *  app started outside a shell may lack the shell's XDG_CONFIG_HOME. */
export function beamEnv(
  paths: BeamPaths,
  env: NodeJS.ProcessEnv
): Record<string, string> {
  return {
    BEAM_CONFIG_DIR: paths.configDir,
    ...(env.BEAM_SOCKET ? { BEAM_SOCKET: paths.socket } : {}),
  };
}

/** `path` with an `app.asar` directory in it replaced by the
 *  `app.asar.unpacked` directory beside it, where an installed app
 *  keeps the files other processes run (electron-builder's asarUnpack).
 *  Other paths are returned unchanged. */
export function unpackedPath(path: string): string {
  return path.replace(/([\\/])app\.asar(?=[\\/])/, '$1app.asar.unpacked');
}

/** The beam binary for this platform, from the `@notaharness/beam`
 *  package the desktop depends on. Throws where it has none. */
export function beamBinary(): string {
  const require = createRequire(import.meta.url);
  const beam = require('@notaharness/beam') as { binaryPath(): string };
  return unpackedPath(beam.binaryPath());
}
