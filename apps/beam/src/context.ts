/**
 * Filesystem layout this CLI adds on top of `$BEAM_DIR` (see docs/beam.md):
 * just the local inbox socket path, which is part of the library's own
 * contract.
 */

import { join } from 'node:path';
import { resolveBeamDir, type BeamDirEnv } from '@n10/beam';
import type { Io } from './io.js';

export function beamDirFor(io: Io): string {
  return resolveBeamDir(io.env as BeamDirEnv);
}

export function inboxSocketPath(beamDir: string): string {
  return join(beamDir, 'run', 'inbox.sock');
}
