import type { AppConfig } from '@n10/vcs-core';
import { tmuxKillSession } from '@n10/terminal-tmux';
import {
  getSession,
  killSession,
  type NamedPtyEntry,
} from '../pty-registry.js';
import { terminalSessionKey } from '../session-key.js';
import {
  isReviewSessionFor,
  isReviewSession,
  type TaggedSession,
} from '../session-identity.js';
import { listOurSessions } from '../session-resolver.js';
import type { AgentDefinition } from '../agents/registry.js';
import { buildAgentLaunch, type LaunchRequest } from './launch-session.js';
import type { MachineEnvRequest } from './machine-env.js';
import { openSession } from './open-session.js';

// ── Background reviews ───────────────────────────────────────────
//
// A review used to launch into the worktree's own session, which meant
// starting one displaced whatever agent was working on the branch. It
// runs in a session of its own instead, against the same checkout, so
// the two proceed at once.
//
// **What that session is.** A terminal session of kind `agent` — n10
// already models those, and they already retain their pane after the
// process exits, which is what makes a transcript nobody watched still
// readable afterwards. What makes it a review is the
// `@orchestra-review` tag naming the pull request. It is deliberately
// not a `worktree` session: that type means "the agent that owns this
// branch", which Orchestra reads as a player, and a review is neither.
//
// **How it is cleaned up.** Launching a review for a pull request
// replaces the previous one for that pull request, so a branch
// reviewed twenty times leaves one session behind, not twenty. It is
// otherwise an ordinary terminal tab: closing it confirms and kills,
// and quitting n10 only detaches.
//
// **What it shares.** The checkout, and nothing else: the session gets
// its own git index (`MachineEnvRequest.isolateGitIndex`), so a review
// reading the diff cannot contend with the working agent over
// `.git/index`. See `machine-env.ts`.

export interface ReviewSessionParams {
  /** Symlink-resolved main checkout — the `@orchestra-repo` tag. */
  repo: string;
  /** The branch under review; the session is tagged and labelled with it. */
  branch: string;
  /** Pull request id — the `@orchestra-review` tag, and this session's identity. */
  pullRequest: string;
  /** The worktree to review in. */
  cwd: string;
  cols: number;
  rows: number;
  config: AppConfig;
  /** A per-launch agent pick; otherwise the configured one. */
  agent?: AgentDefinition;
  request: LaunchRequest;
  machine?: MachineEnvRequest;
}

/** Every background review session on the server, whatever repository. */
export function listReviewSessions(
  sessions: TaggedSession[] = listOurSessions()
): TaggedSession[] {
  return sessions.filter(isReviewSession);
}

/** The background review session for one pull request, or `null`. */
export function findReviewSession(
  repo: string,
  pullRequest: string,
  sessions: TaggedSession[] = listOurSessions()
): TaggedSession | null {
  return sessions.find((s) => isReviewSessionFor(s, repo, pullRequest)) ?? null;
}

/**
 * Start a review of `pullRequest` in its own session.
 *
 * Any earlier review of the same pull request is ended first — one
 * review per pull request is what bounds retained sessions, since a
 * finished one keeps its pane until someone looks at it or closes it.
 */
export async function launchReviewSession(
  params: ReviewSessionParams
): Promise<NamedPtyEntry> {
  endReviewSession(params.repo, params.pullRequest);
  return openSession({
    session: {
      type: 'terminal',
      kind: 'agent',
      repo: params.repo,
      branch: params.branch,
      review: params.pullRequest,
    },
    mode: 'create',
    cwd: params.cwd,
    cols: params.cols,
    rows: params.rows,
    machine: { ...params.machine, isolateGitIndex: true },
    build: () =>
      buildAgentLaunch({
        config: params.config,
        agent: params.agent,
        request: params.request,
      }),
  });
}

/**
 * End the background review of a pull request, if there is one.
 *
 * Kills the entry this process holds when it holds one, so the tab
 * hears about it, and the tmux session either way — a review started
 * by an earlier run is still this repository's to replace.
 */
export function endReviewSession(repo: string, pullRequest: string): void {
  const existing = findReviewSession(repo, pullRequest);
  if (!existing) return;
  const key = terminalSessionKey(existing.name);
  if (getSession(key)) {
    killSession(key);
    return;
  }
  try {
    tmuxKillSession(existing.name);
  } catch {
    // No server, or it ended between the listing and now: either way
    // there is nothing left to replace.
  }
}
