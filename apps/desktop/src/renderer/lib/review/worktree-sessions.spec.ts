import { describe, expect, it } from 'vitest';
import type { TerminalSummary } from '../../../host/contract.js';
import {
  resolvePickedSession,
  selectedSessionName,
  worktreeSessions,
} from './worktree-sessions.js';

const WT = '/repo/.claude/worktrees/feature-x';

const terminal = (over: Partial<TerminalSummary>): TerminalSummary =>
  ({
    name: 'term',
    kind: 'shell',
    cwd: WT,
    displayPath: '~/wt',
    repo: WT,
    running: true,
    spawnedAt: 1,
    ...over,
  } as TerminalSummary);

const base = {
  branchSession: 'branch-key',
  branchAgentRunning: true,
  branchAgentName: 'Claude',
  worktreePath: WT,
};

describe('a worktree’s live sessions', () => {
  it('lists the branch agent first, then the reviewer, then shells', () => {
    // Order is stable on purpose: a row that moves because another
    // session started is a row the user clicks by mistake.
    const sessions = worktreeSessions({
      ...base,
      terminals: [
        terminal({ name: 'shell-1' }),
        terminal({ name: 'review-1', kind: 'agent', review: '42' }),
      ],
    });
    expect(sessions.map((row) => row.name)).toEqual([
      'branch-key',
      'review-1',
      'shell-1',
    ]);
    expect(sessions.map((row) => row.kind)).toEqual([
      'agent',
      'review',
      'shell',
    ]);
  });

  it('names the reviewer by its pull request', () => {
    const [review] = worktreeSessions({
      ...base,
      branchSession: undefined,
      terminals: [terminal({ name: 'r', kind: 'agent', review: '42' })],
    });
    expect(review.label).toBe('Review #42');
  });

  it('leaves out terminals running somewhere else', () => {
    // A terminal belongs to its directory. Another worktree's shell is
    // not this branch's session, however the tab strip groups it.
    const sessions = worktreeSessions({
      ...base,
      terminals: [
        terminal({ name: 'mine' }),
        terminal({ name: 'elsewhere', cwd: '/repo/.claude/worktrees/other' }),
      ],
    });
    expect(sessions.map((row) => row.name)).toEqual(['branch-key', 'mine']);
  });

  it('has no sessions at all on a branch with nothing running', () => {
    expect(
      worktreeSessions({
        branchSession: undefined,
        branchAgentRunning: false,
        terminals: [],
        worktreePath: WT,
      })
    ).toEqual([]);
  });

  it('claims no terminals when the worktree path is unknown', () => {
    // Without a path every terminal would match, and a bare branch
    // would inherit the whole listing.
    expect(
      worktreeSessions({
        ...base,
        worktreePath: undefined,
        terminals: [terminal({ name: 'somewhere' })],
      }).map((row) => row.name)
    ).toEqual(['branch-key']);
  });

  it('numbers shells only when there is more than one', () => {
    const one = worktreeSessions({ ...base, terminals: [terminal({})] });
    expect(one[1].label).toBe('Terminal');
    const two = worktreeSessions({
      ...base,
      terminals: [terminal({ name: 'a' }), terminal({ name: 'b' })],
    });
    expect(two.map((row) => row.label)).toEqual([
      'Claude',
      'Terminal 1',
      'Terminal 2',
    ]);
  });

  it('marks only the branch agent as the branch agent', () => {
    const sessions = worktreeSessions({
      ...base,
      terminals: [terminal({ name: 'r', kind: 'agent', review: '42' })],
    });
    expect(
      sessions.filter((row) => row.isBranchAgent).map((row) => row.name)
    ).toEqual(['branch-key']);
  });

  it('reports an exited session as not running, still listed', () => {
    const sessions = worktreeSessions({
      ...base,
      branchAgentRunning: false,
      terminals: [terminal({ name: 'done', running: false })],
    });
    expect(sessions.map((row) => row.running)).toEqual([false, false]);
  });
});

describe('resolving the picked session', () => {
  const sessions = worktreeSessions({ ...base, terminals: [terminal({})] });

  it('finds the pick', () => {
    expect(resolvePickedSession('term', sessions)?.name).toBe('term');
  });

  it('resolves to nothing when the pick has gone', () => {
    // A pick is a request. The pane falls back rather than resetting
    // it, so a session that comes back under the same name is selected
    // again.
    expect(resolvePickedSession('vanished', sessions)).toBeNull();
    expect(resolvePickedSession(null, sessions)).toBeNull();
  });
});

describe('which row reads as selected', () => {
  const sessions = worktreeSessions({ ...base, terminals: [terminal({})] });
  const picked = resolvePickedSession('term', sessions);

  it('follows the pane that is actually showing', () => {
    expect(selectedSessionName('agent', 'branch-key', picked)).toBe(
      'branch-key'
    );
    expect(selectedSessionName('session', 'branch-key', picked)).toBe('term');
  });

  it('selects nothing while the pane is on something else', () => {
    // Asked of the effective mode, so a pick whose session has gone
    // stops looking selected exactly when the pane falls back.
    expect(selectedSessionName('diff', 'branch-key', picked)).toBeNull();
    expect(selectedSessionName('session', 'branch-key', null)).toBeNull();
  });
});
