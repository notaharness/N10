import { join } from 'node:path';

/**
 * The daemon's control socket, found as beam finds it (beam docs/02,
 * docs/06): `$BEAM_SOCKET`, else `run/beam.sock` in `$BEAM_CONFIG_DIR`,
 * `$XDG_CONFIG_HOME/beam` or `~/.config/beam`.
 */
export function beamSocketPath(env: NodeJS.ProcessEnv, home: string): string {
  if (env.BEAM_SOCKET) return env.BEAM_SOCKET;
  const dir =
    env.BEAM_CONFIG_DIR ||
    join(env.XDG_CONFIG_HOME || join(home, '.config'), 'beam');
  return join(dir, 'run', 'beam.sock');
}
