import { sessionIdentity } from '../session-key.js';

/** Domain intent stays in core; tmux receives an already prepared operation. */
export type SessionRequest =
  | { type: 'worktree'; repo: string; branch: string }
  | {
      type: 'terminal';
      kind: 'shell' | 'agent';
      repo: string;
      target?: string;
      /**
       * The branch this terminal runs against, when it has one. A
       * background review does: it runs in the worktree of the branch
       * it reviews and is tagged with it. It stays a terminal all the
       * same — only a `worktree` session is that branch's player.
       */
      branch?: string;
      /** The pull request id, for a background review session. */
      review?: string;
    };

export function worktreeRequest(key: string): SessionRequest {
  const id = sessionIdentity(key);
  if (id?.kind !== 'worktree')
    throw new Error('Expected a qualified worktree session key');
  return { type: 'worktree', repo: id.repo, branch: id.branch };
}
