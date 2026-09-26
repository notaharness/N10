import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Module from './foreign-sessions.js';

/**
 * The host's answer to "which agents run elsewhere?": every live
 * worktree session except the open repository's own, each with its
 * repository put on the list so its tab can open it.
 */

const state = vi.hoisted(() => ({
  open: '/repos/alpha',
  live: [] as {
    tmuxName: string;
    path: string;
    repoRoot: string;
    branch: string;
    detached: boolean;
    sessionName: string;
  }[],
  realpaths: {} as Record<string, string>,
  recents: [] as string[],
}));

vi.mock('node:fs', () => ({
  realpathSync: (p: string) => state.realpaths[p] ?? p,
}));
vi.mock('@n10/core', () => ({
  listLiveWorktreeSessions: () => state.live,
}));
vi.mock('./repo.js', () => ({
  requireRepo: () => state.open,
}));
vi.mock('./recent-repos.js', () => ({
  ensureRecent: (cwd: string) => {
    if (!state.recents.includes(cwd)) state.recents.push(cwd);
  },
}));

let foreign: typeof Module;

const ALPHA_AGENT = {
  tmuxName: 'alpha-feat-a',
  path: '/repos/alpha/.claude/worktrees/feat-a',
  repoRoot: '/repos/alpha',
  branch: 'feat-a',
  detached: false,
  sessionName: 'feat-a',
};
const BETA_AGENT = {
  tmuxName: 'beta-feat-b',
  path: '/repos/beta/.claude/worktrees/feat-b',
  repoRoot: '/repos/beta',
  branch: 'feat/b',
  detached: false,
  sessionName: 'feat-b',
};
/** A worktree on a detached HEAD, named after its directory. */
const BETA_DETACHED = {
  tmuxName: 'beta-hotfix',
  path: '/repos/beta/.claude/worktrees/hotfix',
  repoRoot: '/repos/beta',
  branch: 'hotfix',
  detached: true,
  sessionName: 'hotfix',
};

beforeEach(async () => {
  state.open = '/repos/alpha';
  state.live = [];
  state.realpaths = {};
  state.recents = [];
  vi.resetModules();
  foreign = await import('./foreign-sessions.js');
});

describe('listForeignSessions', () => {
  it('lists agents of other repositories, and not the open one’s', () => {
    state.live = [ALPHA_AGENT, BETA_AGENT];
    expect(foreign.listForeignSessions()).toEqual([
      {
        repo: '/repos/beta',
        branch: 'feat/b',
        worktree: '/repos/beta/.claude/worktrees/feat-b',
        sessionName: 'feat-b',
      },
    ]);
  });

  it('puts each foreign repository on the repo list', () => {
    state.live = [ALPHA_AGENT, BETA_AGENT];
    foreign.listForeignSessions();
    expect(state.recents).toEqual(['/repos/beta']);
  });

  // This is a read that is polled, and the list is the user's: a
  // repository they removed from it must not come back on every tick.
  // The list is written only when the set of foreign sessions changes.
  it('writes the repo list when the foreign set changes, not on every poll', () => {
    state.live = [BETA_AGENT];
    foreign.listForeignSessions();
    state.recents = []; // the user removed it
    foreign.listForeignSessions();
    foreign.listForeignSessions();
    expect(state.recents).toEqual([]);
    state.live = [
      BETA_AGENT,
      { ...BETA_AGENT, tmuxName: 'gamma-x', repoRoot: '/repos/gamma' },
    ];
    foreign.listForeignSessions();
    expect(state.recents).toEqual(['/repos/beta', '/repos/gamma']);
  });

  // The desktop attaches by branch all the way down, and refuses a
  // detached-HEAD worktree (`discovery.ts`); a tab for one would open
  // its repository and then attach nothing.
  it('leaves out an agent on a detached HEAD, which the desktop cannot attach', () => {
    state.live = [BETA_AGENT, BETA_DETACHED];
    expect(foreign.listForeignSessions().map((s) => s.sessionName)).toEqual([
      'feat-b',
    ]);
  });

  // The core answers with real paths; a repository opened through a
  // symlink must still recognise its own agents rather than list them
  // as foreign — and then open them a second time on switching.
  it('recognises the open repository through a symlink', () => {
    state.open = '/home/dev/link-to-alpha';
    state.realpaths['/home/dev/link-to-alpha'] = '/repos/alpha';
    state.live = [ALPHA_AGENT];
    expect(foreign.listForeignSessions()).toEqual([]);
  });
});
