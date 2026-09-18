/**
 * Filesystem layout this CLI adds on top of `$BEAM_DIR` (see docs/beam.md):
 * only the local inbox socket path is part of the library's own contract;
 * `run/host.json` below is a CLI-local convention (not a library concern)
 * that lets `beam status` report a running node's bind address, which the
 * documented local-IPC `status` op does not carry.
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

/** Where `serve` records its own bind address for `status` to read back —
 * best-effort only; a missing or stale file just means `status` cannot show
 * an address, never a hard failure. */
export function hostInfoPath(beamDir: string): string {
  return join(beamDir, 'run', 'host.json');
}

export interface HostInfo {
  hostname: string;
  port: number;
  pid: number;
}
