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
