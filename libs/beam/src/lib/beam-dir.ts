/**
 * `$BEAM_DIR` resolution — one config directory per machine, holding this
 * node's identity, its peer table and its mailbox. See docs/beam.md.
 */

import { join } from 'node:path';

export interface BeamDirEnv {
  BEAM_CONFIG_DIR?: string;
  XDG_CONFIG_HOME?: string;
  HOME?: string;
  USERPROFILE?: string;
}

/**
 * Resolve `$BEAM_DIR`: `$BEAM_CONFIG_DIR`, else `$XDG_CONFIG_HOME/beam`, else
 * `~/.config/beam`. `env` defaults to `process.env` but is overridable so
 * tests never touch the real home directory.
 */
export function resolveBeamDir(
  env: BeamDirEnv = process.env as unknown as BeamDirEnv
): string {
  if (env.BEAM_CONFIG_DIR) return env.BEAM_CONFIG_DIR;
  if (env.XDG_CONFIG_HOME) return join(env.XDG_CONFIG_HOME, 'beam');
  const home = env.HOME ?? env.USERPROFILE;
  if (!home) {
    throw new Error(
      'cannot resolve $BEAM_DIR: no BEAM_CONFIG_DIR, XDG_CONFIG_HOME, or HOME is set'
    );
  }
  return join(home, '.config', 'beam');
}
