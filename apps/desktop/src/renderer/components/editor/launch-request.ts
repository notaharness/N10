import type { PullRequestInfo } from '@n10/vcs-core';
import type {
  AgentId,
  ReviewLaunchRequest,
  SessionIncarnation,
  SessionLaunchRequest,
} from '../../../host/contract.js';

/** Initial PTY size — the same shape `estimateGrid` in `ItemView` hands
 *  `useItemLaunch`. */
type Grid = Pick<SessionLaunchRequest, 'cols' | 'rows'>;

/**
 * The requests `useItemLaunch` sends the host, split out as pure
 * functions so the local shape can be pinned in a test without
 * mounting a mutation — the pattern `terminalLaunchRequest` set for the
 * terminal dialog's request.
 *
 * A local launch (no `machine`) sends exactly what it sent before this
 * phase — no `machine`, no `launchId` at all, not merely `undefined` —
 * because that is D8: the overwhelming majority of users who never
 * pair anything must see no trace of this feature, request payloads
 * included.
 */
export function sessionLaunchRequest(
  branch: string,
  fresh: boolean,
  pane: Grid,
  expected?: SessionIncarnation,
  agentId?: AgentId,
  machine?: string,
  launchId?: string
): SessionLaunchRequest {
  const base: SessionLaunchRequest = {
    branch,
    intent: fresh ? 'blank' : 'continue-or-blank',
    fresh,
    expected,
    agentId,
    ...pane,
  };
  return machine ? { ...base, machine, launchId } : base;
}

export function reviewLaunchRequest(
  pr: PullRequestInfo,
  instruction: string | undefined,
  pane: Grid,
  expected?: SessionIncarnation,
  agentId?: AgentId,
  machine?: string,
  launchId?: string
): ReviewLaunchRequest {
  const base: ReviewLaunchRequest = {
    pr,
    instruction,
    expected,
    agentId,
    ...pane,
  };
  return machine ? { ...base, machine, launchId } : base;
}
