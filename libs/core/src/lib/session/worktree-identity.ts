import { basename } from 'node:path';
import { readWorktreeHead } from '../discovery/worktree-origin.js';
import { canonicalWorktreePath, LOCAL_MACHINE } from '../session-key.js';
import type { SessionRequest } from './session-request.js';

/** What a new worktree session is tagged with: the branch it is created
 *  for — the caller's, else what is checked out, else (detached) the
 *  directory's name — and the checkout it belongs to. */
export function worktreeIdentity(
  request: Extract<SessionRequest, { type: 'worktree' }>,
  cwd: string
): { type: 'worktree'; branch: string; worktreePath: string } {
  const machine = request.machine ?? LOCAL_MACHINE;
  const head = machine === LOCAL_MACHINE ? readWorktreeHead(cwd) : null;
  return {
    type: 'worktree',
    branch: request.branch || head?.branch || basename(request.path),
    worktreePath: canonicalWorktreePath(request.path, machine),
  };
}
