import type { TerminalSummary } from '../../../host/contract.js';

/**
 * The live sessions of one worktree, as the rail lists them.
 *
 * A worktree can hold several at once — the agent working on the
 * branch, a reviewer running beside it, a shell the user opened for
 * ad-hoc work — and the point of listing them is to switch between
 * them. They are different kinds of thing to n10 (the branch agent is
 * a `worktree` session keyed by branch; the rest are terminals keyed
 * by their tmux name), which is exactly why the rail needs one list
 * that does not care.
 */

export type WorktreeSessionKind = 'agent' | 'review' | 'shell';

export interface WorktreeSession {
  /** Registry key — what the terminal pane renders. */
  name: string;
  label: string;
  kind: WorktreeSessionKind;
  running: boolean;
  /** The branch's own agent, which has Stop and Relaunch beside it. */
  isBranchAgent: boolean;
}

/** A terminal belongs to this worktree when it runs in its directory. */
function inWorktree(
  terminal: TerminalSummary,
  worktreePath: string | undefined
): boolean {
  return worktreePath !== undefined && terminal.cwd === worktreePath;
}

/** Reviews are partitioned out before this, so it only sees the rest. */
function terminalKind(terminal: TerminalSummary): WorktreeSessionKind {
  return terminal.kind === 'agent' ? 'agent' : 'shell';
}

function terminalLabel(
  terminal: TerminalSummary,
  kind: WorktreeSessionKind,
  index: number,
  total: number
): string {
  if (kind === 'review') return `Review #${terminal.review}`;
  const base = kind === 'agent' ? terminal.agent ?? 'Agent' : 'Terminal';
  // Numbered only when there is more than one to tell apart.
  return total > 1 ? `${base} ${index + 1}` : base;
}

export interface WorktreeSessionsInput {
  /** The branch's own agent session, if it has one. */
  branchSession?: string;
  branchAgentRunning: boolean;
  /** Display name of the agent in the branch session. */
  branchAgentName?: string;
  /** Every terminal the host holds, unfiltered. */
  terminals: TerminalSummary[];
  /** The branch's checkout; terminals elsewhere are not its sessions. */
  worktreePath?: string;
}

/**
 * Build the list, branch agent first.
 *
 * Order is deliberate and stable: the branch agent, then the reviewer,
 * then shells in the order the host lists them. A row moving because
 * another session started is a row the user clicks by mistake.
 */
export function worktreeSessions({
  branchSession,
  branchAgentRunning,
  branchAgentName,
  terminals,
  worktreePath,
}: WorktreeSessionsInput): WorktreeSession[] {
  const mine = terminals.filter((t) => inWorktree(t, worktreePath));
  const reviews = mine.filter((t) => t.review);
  const others = mine.filter((t) => !t.review);
  const sessions: WorktreeSession[] = [];
  if (branchSession) {
    sessions.push({
      name: branchSession,
      label: branchAgentName ?? 'Agent',
      kind: 'agent',
      running: branchAgentRunning,
      isBranchAgent: true,
    });
  }
  for (const terminal of reviews) {
    sessions.push(summarize(terminal, 'review', 0, reviews.length));
  }
  others.forEach((terminal, i) => {
    sessions.push(
      summarize(terminal, terminalKind(terminal), i, others.length)
    );
  });
  return sessions;
}

function summarize(
  terminal: TerminalSummary,
  kind: WorktreeSessionKind,
  index: number,
  total: number
): WorktreeSession {
  return {
    name: terminal.name,
    label: terminalLabel(terminal, kind, index, total),
    kind,
    running: terminal.running,
    isBranchAgent: false,
  };
}

/**
 * The session the pane should show, given what the user picked.
 *
 * A pick is a *request*, like every other pane mode: the session it
 * names can end and be dropped from the listing while it is selected.
 * Rather than reset the pick, an unknown one simply resolves to
 * nothing and the pane falls back — so when the session comes back
 * (a restart keeps the name), so does the selection.
 */
export function resolvePickedSession(
  picked: string | null,
  sessions: WorktreeSession[]
): WorktreeSession | null {
  if (!picked) return null;
  return sessions.find((s) => s.name === picked) ?? null;
}

/**
 * Which row the rail should show as selected, given the pane that is
 * actually showing.
 *
 * Asked of the *effective* mode rather than the requested one, so a
 * pick whose session has gone stops looking selected at the same
 * moment the pane falls back to the diff.
 */
export function selectedSessionName(
  effMode: string,
  branchSession: string | undefined,
  picked: WorktreeSession | null
): string | null {
  if (effMode === 'agent') return branchSession ?? null;
  if (effMode === 'session') return picked?.name ?? null;
  return null;
}
