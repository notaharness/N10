/**
 * Shared `cwd` rule for `pty` and `exec` open parameters (docs/beam.md): a
 * `cwd` must be absolute or start with `~/`; anything else is rejected
 * rather than silently resolved against the host's own working directory,
 * which would put the caller somewhere it never asked to be.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

export type CwdResult =
  | { ok: true; cwd: string }
  | { ok: false; reason: string };

export function resolveCwd(cwd: unknown): CwdResult {
  if (cwd === undefined) return { ok: true, cwd: process.cwd() };
  if (typeof cwd !== 'string' || cwd.length === 0) {
    return { ok: false, reason: 'cwd must be a non-empty string' };
  }
  if (cwd.startsWith('/')) return { ok: true, cwd };
  if (cwd === '~' || cwd.startsWith('~/')) {
    return { ok: true, cwd: join(homedir(), cwd.slice(1)) };
  }
  return {
    ok: false,
    reason: `cwd must be absolute or start with ~/, got: ${cwd}`,
  };
}
