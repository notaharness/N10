import { LOCAL_MACHINE, sessionIdentity } from '../session-key.js';

/**
 * Domain intent stays in core; tmux receives an already prepared
 * operation. `machine` is a beam peerId, or omitted/`'local'` for this
 * machine (decisions.md D2) — the one place a caller says which
 * machine a session should live on. `open-session.ts` is the only
 * place that reads it to decide local vs. remote.
 */
export type SessionRequest =
  | { type: 'worktree'; repo: string; branch: string; machine?: string }
  | {
      type: 'terminal';
      kind: 'shell' | 'agent';
      repo: string;
      target?: string;
      machine?: string;
    };

export function worktreeRequest(key: string): SessionRequest {
  const id = sessionIdentity(key);
  if (id?.kind !== 'worktree')
    throw new Error('Expected a qualified worktree session key');
  return {
    type: 'worktree',
    repo: id.repo,
    branch: id.branch,
    ...(id.machine !== LOCAL_MACHINE ? { machine: id.machine } : {}),
  };
}
