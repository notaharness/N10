import {
  keyForWorktree,
  worktreeSessionKey,
  type SidebarItem,
  type TaggedSession,
} from '@n10/core';
import { describe, expect, it } from 'vitest';
import {
  movedWorktreeSessions,
  withMovedSessions,
} from './worktree-sessions.js';

const REPO = '/repo';
const WT = '/repo/.claude/worktrees/feature';

function tagged(
  branch: string,
  path = WT,
  created = 1
): TaggedSession {
  return {
    name: `repo-${branch}`,
    created,
    paneDead: false,
    path,
    spawner: 'n10',
    repo: REPO,
    type: 'worktree',
    branch,
    machine: 'local',
  };
}

const key = (branch: string) => worktreeSessionKey(branch, REPO);

describe('movedWorktreeSessions', () => {
  it('ties the session running in a switched worktree to its row by path', () => {
    const moved = movedWorktreeSessions(
      [{ branch: 'other', path: WT }],
      REPO,
      [key('feature')],
      () => [tagged('feature')]
    );
    expect(moved.get(keyForWorktree({ branch: 'other', path: WT }, REPO)))
      .toEqual({ name: key('feature'), branch: 'feature' });
  });

  it('prefers a session created for the branch checked out now', () => {
    const moved = movedWorktreeSessions(
      [{ branch: 'other', path: WT }],
      REPO,
      [key('feature'), key('other')],
      () => [tagged('feature'), tagged('other', WT, 2)]
    );
    expect(moved.size).toBe(0);
  });

  it('takes the newest of several leftovers in one directory', () => {
    const moved = movedWorktreeSessions(
      [{ branch: 'third', path: WT }],
      REPO,
      [key('feature'), key('other')],
      () => [tagged('feature', WT, 1), tagged('other', WT, 5)]
    );
    expect([...moved.values()]).toEqual([{ name: key('other'), branch: 'other' }]);
  });

  it('ignores sessions this host does not hold, and ones elsewhere', () => {
    const moved = movedWorktreeSessions(
      [{ branch: 'other', path: WT }],
      REPO,
      [key('elsewhere')],
      () => [tagged('feature'), tagged('elsewhere', '/repo/.claude/worktrees/x')]
    );
    expect(moved.size).toBe(0);
  });

  it('does not ask tmux when every held session answers to a row', () => {
    const moved = movedWorktreeSessions(
      [{ branch: 'feature', path: WT }],
      REPO,
      [key('feature'), JSON.stringify(['terminal', 'repo-shell'])],
      () => {
        throw new Error('listed tmux');
      }
    );
    expect(moved.size).toBe(0);
  });
});

describe('withMovedSessions', () => {
  const row = (name: string): SidebarItem => ({
    kind: 'session',
    session: { name, running: false, path: WT },
    branch: 'other',
    isMerged: false,
  });

  it('points the row at the moved session and says which branch it was for', () => {
    const [item] = withMovedSessions(
      [row(key('other'))],
      new Map([[key('other'), { name: key('feature'), branch: 'feature' }]]),
      (name) => name === key('feature')
    );
    expect(item.kind === 'session' && item.session).toEqual({
      name: key('feature'),
      running: true,
      path: WT,
      sessionBranch: 'feature',
    });
  });

  it('leaves rows with nothing moved as they are', () => {
    const items = [row(key('other'))];
    expect(withMovedSessions(items, new Map(), () => true)).toBe(items);
  });
});
