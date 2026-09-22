import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolve as pathResolve } from 'node:path';
import {
  checkoutWorktree,
  createWorktree,
  removeWorktree,
  canRemoveBranch,
  rebaseOntoMaster,
} from './worktree.js';
import { assertShellSafeRef, branchToSessionName } from './refs.js';
import {
  parseWorktrees,
  listWorktrees,
  worktreeSessionName,
} from './worktree-list.js';
import {
  resetWorktreeResolver,
  setWorktreeResolver,
  worktreesBasePath,
  ownsWorktreePath,
  createTemplateResolver,
} from './worktree-resolver.js';
import {
  deleteBranch,
  listBranches,
  fetchRemote,
  listAllBranches,
  fastForwardMainBranch,
  countConflicts,
  countConflictsBetween,
  fetchBranches,
  refExists,
  getMainBranch,
  resetMainBranchCache,
} from './branches.js';
import { existsSync, readFileSync } from 'node:fs';
import type * as ExecModule from './exec.js';
import type { Machine, MachineExecutor } from './machine.js';

vi.mock('./exec.js', async (importOriginal) => ({
  ...(await importOriginal<typeof ExecModule>()),
  exec: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => {
    throw new Error('readFileSync not mocked for this test');
  }),
}));

import { exec } from './exec.js';

const mockExec = vi.mocked(exec);
const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);

function resolve(stdout = '') {
  return { stdout, stderr: '' };
}

/**
 * Build a `git worktree list --porcelain` payload for the given
 * branch→dir mappings. `removeWorktree`/`canRemoveBranch` consult this
 * to find a worktree's real path instead of deriving it from the branch
 * name. Omitting `dir` places the worktree at the conventional
 * resolver-derived `.claude/worktrees/<session>` path (a worktree whose
 * directory matches its branch name); pass an explicit `dir` to model a
 * mismatched directory. To model a branch with no live worktree, pass an
 * empty entries array.
 *
 * `root` is the repository the worktrees sit under, defaulting to the
 * process's directory. Pass one to model a listing for a repository a
 * caller named explicitly. Paths are emitted with forward slashes on
 * every platform, which is what git's porcelain does.
 */
function worktreeListPorcelain(
  entries: { branch: string; dir?: string }[],
  root = process.cwd()
) {
  const cwd = root.replace(/\\/g, '/');
  const blocks = entries.map(({ branch, dir }) =>
    [
      `worktree ${cwd}/${
        dir ?? `.claude/worktrees/${branchToSessionName(branch)}`
      }`,
      'HEAD abc123',
      `branch refs/heads/${branch}`,
      '',
    ].join('\0')
  );
  return resolve(blocks.join('\0'));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockExec.mockReset();
  mockExistsSync.mockReset().mockReturnValue(false);
  mockReadFileSync.mockReset().mockImplementation(() => {
    throw new Error('ENOENT');
  });
  resetMainBranchCache();
  resetWorktreeResolver();
});

describe('listBranches', () => {
  it('should parse git branch output into array', async () => {
    mockExec.mockResolvedValueOnce(
      resolve('main\nfeature/auth\nfix/bug-123\n')
    );
    const branches = await listBranches();
    expect(branches).toEqual(['main', 'feature/auth', 'fix/bug-123']);
  });

  it('should return empty array when git fails', async () => {
    mockExec.mockRejectedValueOnce(new Error('not a git repository'));
    expect(await listBranches()).toEqual([]);
  });

  it('should filter out empty lines', async () => {
    mockExec.mockResolvedValueOnce(resolve('main\n\ndev\n'));
    expect(await listBranches()).toEqual(['main', 'dev']);
  });
});

describe('createWorktree', () => {
  it('should return absolute path for existing branch', async () => {
    // No worktree has the branch checked out anywhere.
    mockExec.mockResolvedValueOnce(worktreeListPorcelain([]));
    mockExec.mockResolvedValueOnce(resolve());
    const result = await createWorktree('feature/auth');
    expect(result).toContain('.claude/worktrees/feature-auth');
    expect(result).toMatch(/^\//); // absolute path
    expect(mockExec).toHaveBeenCalledWith(
      'git worktree add ".claude/worktrees/feature-auth" "feature/auth"',
      { encoding: 'utf8', cwd: process.cwd() }
    );
  });

  it('should fall back to -b for new branch', async () => {
    mockExec
      .mockResolvedValueOnce(worktreeListPorcelain([]))
      .mockRejectedValueOnce(new Error('branch not found'))
      .mockResolvedValueOnce(resolve());
    const result = await createWorktree('new-branch');
    expect(result).toContain('.claude/worktrees/new-branch');
    expect(mockExec).toHaveBeenCalledTimes(3);
    expect(mockExec).toHaveBeenLastCalledWith(
      'git worktree add -b "new-branch" ".claude/worktrees/new-branch"',
      { encoding: 'utf8', cwd: process.cwd() }
    );
  });

  it('should return null when both attempts fail', async () => {
    mockExec
      .mockResolvedValueOnce(worktreeListPorcelain([]))
      .mockRejectedValueOnce(new Error('fail'))
      .mockRejectedValueOnce(new Error('fail'));
    expect(await createWorktree('bad-branch')).toBeNull();
  });

  it('rejects a derived directory occupied by a different exact branch', async () => {
    mockExec.mockResolvedValueOnce(
      worktreeListPorcelain([{ branch: 'feature-auth' }])
    );
    mockExistsSync.mockReturnValue(true);
    expect(await createWorktree('feature/auth')).toBeNull();
    expect(mockExec).toHaveBeenCalledTimes(1);
  });

  it('reuses a worktree that has the branch checked out under another directory name', async () => {
    // Nothing at the resolver-derived path, but git reports the branch
    // checked out at a directory named differently — created outside
    // n10, or by n10 under a different worktreePath template.
    mockExec.mockResolvedValueOnce(
      worktreeListPorcelain([
        { branch: 'feature/auth', dir: '.claude/worktrees/some-other-name' },
      ])
    );
    const result = await createWorktree('feature/auth');
    expect(result).toContain('.claude/worktrees/some-other-name');
    // The lookup is the only git call: no `worktree add` is attempted,
    // which would fail with "already used by worktree at …".
    expect(mockExec).toHaveBeenCalledTimes(1);
    expect(mockExec).not.toHaveBeenCalledWith(
      expect.stringContaining('worktree add'),
      expect.anything()
    );
  });

  it('reuses only a checkout whose exact branch matches', async () => {
    mockExec.mockResolvedValueOnce(
      worktreeListPorcelain([{ branch: 'feature/auth' }])
    );
    const result = await createWorktree('feature/auth');
    expect(result).toContain('.claude/worktrees/feature-auth');
    expect(result).toMatch(/^\//);
    expect(mockExec).toHaveBeenCalledTimes(1);
  });
});

/**
 * A checkout on behalf of a branch the caller did not choose — a pull
 * request's source branch — must never fall back to inventing one.
 */
describe('checkoutWorktree', () => {
  it('checks out an existing branch into the repository it is given', async () => {
    // No worktree in that repository has the branch checked out.
    mockExec.mockResolvedValueOnce(worktreeListPorcelain([]));
    mockExec.mockResolvedValueOnce(resolve());
    const result = await checkoutWorktree('feature/auth', '/repos/one');
    expect(result).toBe('/repos/one/.claude/worktrees/feature-auth');
    expect(mockExec).toHaveBeenCalledWith(
      'git worktree add ".claude/worktrees/feature-auth" "feature/auth"',
      { encoding: 'utf8', cwd: '/repos/one' }
    );
  });

  it('never creates a branch: one git refuses is a failure', async () => {
    mockExec
      .mockResolvedValueOnce(worktreeListPorcelain([]))
      .mockRejectedValueOnce(new Error('invalid reference'));
    expect(await checkoutWorktree('missing', '/repos/one')).toBeNull();
    expect(mockExec).toHaveBeenCalledTimes(2);
    expect(
      mockExec.mock.calls.map(([command]) => command).join('\n')
    ).not.toContain('-b');
  });

  // These three build their repository roots with `path.resolve` and
  // compare against git's forward-slash shape, so they hold on Windows
  // too, where a bare '/repos/one' resolves to 'C:\repos\one'.
  const repoOne = pathResolve('/repos/one');
  const repoTwo = pathResolve('/repos/two');
  const asGitReportsIt = (p: string) => p.replace(/\\/g, '/');

  it('asks git about the repository it was given, not the process one', async () => {
    mockExec.mockResolvedValue(worktreeListPorcelain([]));
    await checkoutWorktree('feature/auth', repoOne);
    expect(mockExec).toHaveBeenCalledWith('git worktree list --porcelain -z', {
      encoding: 'utf8',
      cwd: repoOne,
    });
  });

  it('reuses a worktree that has the branch checked out under another directory name', async () => {
    // The babysitter's spawn path lands here. Without the lookup both
    // this and `git worktree add` come up empty — the branch is already
    // checked out — and the agent is never started.
    mockExec.mockResolvedValueOnce(
      worktreeListPorcelain(
        [{ branch: 'feature/auth', dir: '.claude/worktrees/other-name' }],
        repoOne
      )
    );
    const result = await checkoutWorktree('feature/auth', repoOne);
    expect(result).toBe(
      `${asGitReportsIt(repoOne)}/.claude/worktrees/other-name`
    );
    expect(mockExec).toHaveBeenCalledTimes(1);
    expect(mockExec).not.toHaveBeenCalledWith(
      expect.stringContaining('worktree add'),
      expect.anything()
    );
  });

  it('ignores a worktree of that branch outside the given repository', async () => {
    // Ownership is judged against the repository asked about, so a
    // checkout of the same branch in a different repo is not an answer.
    mockExec
      .mockResolvedValueOnce(
        worktreeListPorcelain(
          [{ branch: 'feature/auth', dir: '.claude/worktrees/elsewhere' }],
          repoTwo
        )
      )
      .mockResolvedValueOnce(resolve());
    const result = await checkoutWorktree('feature/auth', repoOne);
    expect(result).toBe(pathResolve(repoOne, '.claude/worktrees/feature-auth'));
    expect(mockExec).toHaveBeenLastCalledWith(
      'git worktree add ".claude/worktrees/feature-auth" "feature/auth"',
      { encoding: 'utf8', cwd: repoOne }
    );
  });

  it('refuses a derived directory occupied by a different branch', async () => {
    mockExec.mockResolvedValueOnce(
      worktreeListPorcelain([{ branch: 'feature-auth' }], repoOne)
    );
    mockExistsSync.mockReturnValue(true);
    expect(await checkoutWorktree('feature/auth', repoOne)).toBeNull();
    expect(mockExec).toHaveBeenCalledTimes(1);
  });

  it('runs against the process directory when no repository is given', async () => {
    mockExec.mockResolvedValueOnce(resolve());
    const result = await checkoutWorktree('feature/auth');
    expect(result).toBe(
      pathResolve(process.cwd(), '.claude/worktrees/feature-auth')
    );
    expect(mockExec).toHaveBeenCalledWith(expect.any(String), {
      encoding: 'utf8',
      cwd: process.cwd(),
    });
  });
});

/**
 * The babysitter outlives the desktop's chdir between repositories,
 * so each of its git calls names the repository it is about.
 */
describe('git calls scoped to a repository', () => {
  it('refExists asks in the given repository', async () => {
    mockExec.mockResolvedValueOnce(resolve('abc'));
    expect(await refExists('origin/feat', '/repos/one')).toBe(true);
    expect(mockExec).toHaveBeenCalledWith(
      'git rev-parse --verify --quiet "origin/feat^{commit}"',
      { encoding: 'utf8', cwd: '/repos/one' }
    );
  });

  it('fetchBranches fetches in the given repository', async () => {
    mockExec.mockResolvedValueOnce(resolve());
    expect(await fetchBranches(['main', 'feat'], '/repos/one')).toBe(true);
    expect(mockExec).toHaveBeenCalledWith('git fetch origin main feat', {
      encoding: 'utf8',
      cwd: '/repos/one',
    });
  });

  it('countConflictsBetween merges in the given repository', async () => {
    mockExec.mockResolvedValueOnce(resolve());
    expect(
      await countConflictsBetween('origin/main', 'origin/feat', '/repos/one')
    ).toBe(0);
    expect(mockExec).toHaveBeenCalledWith(
      'git merge-tree --write-tree origin/main "origin/feat"',
      { encoding: 'utf8', cwd: '/repos/one' }
    );
  });

  it('leaves the process directory in charge when none is given', async () => {
    mockExec.mockResolvedValueOnce(resolve('abc'));
    await refExists('origin/feat');
    expect(mockExec).toHaveBeenCalledWith(expect.any(String), {
      encoding: 'utf8',
    });
  });
});

describe('removeWorktree', () => {
  const cwd = process.cwd();

  it('should return true on success', async () => {
    mockExec.mockResolvedValueOnce(
      worktreeListPorcelain([{ branch: 'feature/auth' }])
    );
    mockExec.mockResolvedValueOnce(resolve());
    expect(await removeWorktree('feature/auth')).toBe(true);
    expect(mockExec).toHaveBeenCalledWith(
      `git worktree remove "${cwd}/.claude/worktrees/feature-auth"`,
      { encoding: 'utf8', cwd: process.cwd() }
    );
  });

  // Regression (auto-delete spam): a worktree whose directory name does
  // not match its branch. Here dir `investigate-ci-performance` holds
  // branch `ci/perf-setup-sticky-disk`. Deriving the dir from the branch
  // name (`ci-perf-setup-sticky-disk`) points at a path that does not
  // exist, so `git worktree remove` fails, the worktree survives, and
  // the merged branch is re-detected + re-"auto-deleted" on every sync.
  // The routing mock makes only the *real* dir removable, so this test
  // fails against the branch-derived implementation and passes once the
  // path is resolved from git.
  it('removes a worktree whose directory name differs from the branch name', async () => {
    const realDir = `${cwd}/.claude/worktrees/investigate-ci-performance`;
    mockExec.mockImplementation((command: string) => {
      if (command.includes('git worktree list')) {
        return Promise.resolve(
          worktreeListPorcelain([
            {
              branch: 'ci/perf-setup-sticky-disk',
              dir: '.claude/worktrees/investigate-ci-performance',
            },
          ])
        );
      }
      if (command.startsWith('git worktree remove')) {
        // Only the real on-disk path can be removed; the branch-derived
        // path does not exist and git errors out.
        if (command.includes(realDir)) return Promise.resolve(resolve());
        return Promise.reject(new Error("fatal: '...' is not a working tree"));
      }
      return Promise.resolve(resolve());
    });

    expect(
      await removeWorktree('ci/perf-setup-sticky-disk', { force: true })
    ).toBe(true);
    expect(mockExec).toHaveBeenCalledWith(
      `git worktree remove --force "${realDir}"`,
      { encoding: 'utf8', cwd: process.cwd() }
    );
  });

  // Regression (auto-delete spam, mid-rebase variant): a worktree that
  // is mid-rebase reports a detached HEAD, so `git worktree list
  // --porcelain` emits no `branch` line — the logical branch is only
  // recoverable from the rebase state. Combined with a directory name
  // that does not match the branch, matching on the porcelain branch
  // line finds nothing and the branch-derived fallback path is wrong, so
  // removal targets a nonexistent path and the merged branch re-spams the
  // auto-delete flash on every sync. Resolving the path via the same
  // machinery that recovers the rebasing branch fixes it.
  it('removes a mid-rebase worktree whose directory name differs from the branch name', async () => {
    const realDir = `${cwd}/.claude/worktrees/investigate-ci-performance`;
    const gitdir = `${cwd}/.git/worktrees/investigate-ci-performance`;
    mockExec.mockImplementation((command: string) => {
      if (command.includes('git worktree list')) {
        return Promise.resolve(
          resolve(
            [
              `worktree ${cwd}`,
              'HEAD aaa111',
              'branch refs/heads/main',
              '',
              `worktree ${realDir}`,
              'HEAD bbb222',
              'detached',
              '',
            ].join('\0')
          )
        );
      }
      if (command.startsWith('git worktree remove')) {
        if (command.includes(realDir)) return Promise.resolve(resolve());
        return Promise.reject(new Error("fatal: '...' is not a working tree"));
      }
      return Promise.resolve(resolve());
    });
    mockReadFileSync.mockImplementation(((p: string) => {
      if (p === `${realDir}/.git`) return `gitdir: ${gitdir}\n`;
      if (p === `${gitdir}/rebase-merge/head-name`) {
        return 'refs/heads/ci/perf-setup-sticky-disk\n';
      }
      throw new Error(`ENOENT: ${p}`);
    }) as unknown as typeof readFileSync);

    expect(
      await removeWorktree('ci/perf-setup-sticky-disk', { force: true })
    ).toBe(true);
    expect(mockExec).toHaveBeenCalledWith(
      `git worktree remove --force "${realDir}"`,
      { encoding: 'utf8', cwd: process.cwd() }
    );
  });

  it('does not remove a guessed directory when git has no such branch', async () => {
    mockExec.mockResolvedValueOnce(worktreeListPorcelain([]));
    expect(await removeWorktree('feature/auth')).toBe(false);
    expect(mockExec).toHaveBeenCalledTimes(1);
  });

  it('should return false on failure', async () => {
    mockExec.mockResolvedValueOnce(
      worktreeListPorcelain([{ branch: 'nonexistent' }])
    );
    mockExec.mockRejectedValueOnce(new Error('not found'));
    expect(await removeWorktree('nonexistent')).toBe(false);
  });
});

describe('deleteBranch', () => {
  it('should return true on success and call git branch -d', async () => {
    mockExec.mockResolvedValueOnce(resolve());
    expect(await deleteBranch('feature/auth')).toBe(true);
    expect(mockExec).toHaveBeenCalledWith('git branch -d "feature/auth"', {
      encoding: 'utf8',
      cwd: process.cwd(),
    });
  });

  it('should return false on failure', async () => {
    mockExec.mockRejectedValueOnce(new Error('branch not found'));
    expect(await deleteBranch('nonexistent')).toBe(false);
  });

  it('should use -D flag when force is true', async () => {
    mockExec.mockResolvedValueOnce(resolve());
    expect(await deleteBranch('feature/auth', true)).toBe(true);
    expect(mockExec).toHaveBeenCalledWith('git branch -D "feature/auth"', {
      encoding: 'utf8',
      cwd: process.cwd(),
    });
  });

  it('should properly quote the branch name', async () => {
    mockExec.mockResolvedValueOnce(resolve());
    await deleteBranch('feat/ui/sidebar');
    expect(mockExec).toHaveBeenCalledWith('git branch -d "feat/ui/sidebar"', {
      encoding: 'utf8',
      cwd: process.cwd(),
    });
  });
});

describe('canRemoveBranch', () => {
  it('should reject main as protected', async () => {
    expect(await canRemoveBranch('main')).toEqual({
      safe: false,
      reason: 'protected branch',
    });
  });

  it('should reject master as protected', async () => {
    expect(await canRemoveBranch('master')).toEqual({
      safe: false,
      reason: 'protected branch',
    });
  });

  it('should reject gitbutler branches as protected', async () => {
    expect(await canRemoveBranch('gitbutler/integration')).toEqual({
      safe: false,
      reason: 'protected branch',
    });
  });

  it('should reject branches with uncommitted changes', async () => {
    mockExec.mockResolvedValueOnce(
      worktreeListPorcelain([{ branch: 'feature/dirty' }])
    );
    mockExec.mockResolvedValueOnce(resolve(' M src/file.ts\n'));
    expect(await canRemoveBranch('feature/dirty')).toEqual({
      safe: false,
      reason: 'uncommitted changes',
    });
  });

  it('should reject branches not pushed to upstream', async () => {
    mockExec.mockResolvedValueOnce(
      worktreeListPorcelain([{ branch: 'feature/unpushed' }])
    );
    mockExec.mockResolvedValueOnce(resolve(''));
    mockExec.mockResolvedValueOnce(resolve('abc1234 some commit\n'));
    expect(await canRemoveBranch('feature/unpushed')).toEqual({
      safe: false,
      reason: 'not pushed to upstream',
    });
  });

  it('should return safe for clean, pushed branches', async () => {
    mockExec.mockResolvedValueOnce(
      worktreeListPorcelain([{ branch: 'feature/done' }])
    );
    mockExec.mockResolvedValueOnce(resolve(''));
    mockExec.mockResolvedValueOnce(resolve(''));
    expect(await canRemoveBranch('feature/done')).toEqual({ safe: true });
  });

  // Regression: when the worktree dir does not match the branch name,
  // the uncommitted-changes guard must run against the real checkout.
  // Against the branch-derived path the `git status` call errors, the
  // guard silently skips, and a dirty worktree is wrongly reported safe
  // to delete. The routing mock reports the real checkout as dirty and
  // errors for any other path, so this fails against the branch-derived
  // implementation and passes once the path is resolved from git.
  it('runs the dirty-tree guard against the real worktree path, not a derived guess', async () => {
    // Forward slashes throughout, matching what git's porcelain emits
    // and so what `worktreeListPorcelain` builds.
    const realDir = `${process
      .cwd()
      .replace(/\\/g, '/')}/.claude/worktrees/investigate-ci-performance`;
    mockExec.mockImplementation((command: string) => {
      if (command.includes('git worktree list')) {
        return Promise.resolve(
          worktreeListPorcelain([
            {
              branch: 'ci/perf-setup-sticky-disk',
              dir: '.claude/worktrees/investigate-ci-performance',
            },
          ])
        );
      }
      if (command.includes('status --porcelain')) {
        if (command.includes(realDir)) {
          return Promise.resolve(resolve(' M src/file.ts\n'));
        }
        return Promise.reject(new Error('not a git repository'));
      }
      return Promise.resolve(resolve());
    });

    expect(await canRemoveBranch('ci/perf-setup-sticky-disk', true)).toEqual({
      safe: false,
      reason: 'uncommitted changes',
    });
    expect(mockExec).toHaveBeenCalledWith(
      `git -C "${realDir}" status --porcelain`,
      { encoding: 'utf8' }
    );
  });

  // A mid-rebase worktree carries in-progress rebase state that
  // force-removing the worktree would silently destroy, so it must be
  // reported unsafe to delete regardless of merge status — the caller
  // surfaces this and leaves the worktree alone until the rebase is
  // finished or aborted. Only the worktree lookup runs; no status or
  // unpushed checks.
  it('should reject a mid-rebase worktree as unsafe to delete', async () => {
    const wtPath = `${process.cwd()}/.claude/worktrees/investigate-ci-performance`;
    const gitdir = `${process.cwd()}/.git/worktrees/investigate-ci-performance`;
    mockExec.mockResolvedValueOnce(
      resolve([`worktree ${wtPath}`, 'HEAD bbb222', 'detached', ''].join('\0'))
    );
    mockReadFileSync.mockImplementation(((p: string) => {
      if (p === `${wtPath}/.git`) return `gitdir: ${gitdir}\n`;
      if (p === `${gitdir}/rebase-merge/head-name`) {
        return 'refs/heads/ci/perf-setup-sticky-disk\n';
      }
      throw new Error(`ENOENT: ${p}`);
    }) as unknown as typeof readFileSync);

    expect(await canRemoveBranch('ci/perf-setup-sticky-disk', true)).toEqual({
      safe: false,
      reason: 'rebase in progress',
    });
    expect(mockExec).toHaveBeenCalledTimes(1);
  });

  it('should skip checks gracefully when worktree does not exist', async () => {
    mockExec.mockResolvedValueOnce(worktreeListPorcelain([]));
    mockExec.mockRejectedValueOnce(new Error('not a directory'));
    mockExec.mockResolvedValueOnce(resolve(''));
    expect(await canRemoveBranch('feature/no-worktree')).toEqual({
      safe: true,
    });
  });

  it('should skip unpushed check when confirmedMerged is true', async () => {
    // Only the worktree lookup + status check run (status clean), no git log call
    mockExec.mockResolvedValueOnce(
      worktreeListPorcelain([{ branch: 'feature/squash-merged' }])
    );
    mockExec.mockResolvedValueOnce(resolve(''));
    expect(await canRemoveBranch('feature/squash-merged', true)).toEqual({
      safe: true,
    });
    expect(mockExec).toHaveBeenCalledTimes(2);
  });

  it('should still reject uncommitted changes when confirmedMerged is true', async () => {
    mockExec.mockResolvedValueOnce(
      worktreeListPorcelain([{ branch: 'feature/dirty-merged' }])
    );
    mockExec.mockResolvedValueOnce(resolve(' M src/file.ts\n'));
    expect(await canRemoveBranch('feature/dirty-merged', true)).toEqual({
      safe: false,
      reason: 'uncommitted changes',
    });
  });

  it('should still reject protected branches when confirmedMerged is true', async () => {
    expect(await canRemoveBranch('master', true)).toEqual({
      safe: false,
      reason: 'protected branch',
    });
  });
});

describe('parseWorktrees', () => {
  it('should parse multiple worktrees from porcelain output', () => {
    const output = [
      'worktree /home/user/repo',
      'HEAD abc123',
      'branch refs/heads/main',
      '',
      'worktree /home/user/repo/.claude/worktrees/feature-auth',
      'HEAD def456',
      'branch refs/heads/feature/auth',
      '',
      'worktree /home/user/repo/.claude/worktrees/fix-bug',
      'HEAD 789abc',
      'branch refs/heads/fix/bug',
      '',
    ].join('\0');

    const result = parseWorktrees(output);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({
      path: '/home/user/repo',
      branch: 'main',
      bare: false,
    });
    expect(result[1]).toEqual({
      path: '/home/user/repo/.claude/worktrees/feature-auth',
      branch: 'feature/auth',
      bare: false,
    });
    expect(result[2]).toEqual({
      path: '/home/user/repo/.claude/worktrees/fix-bug',
      branch: 'fix/bug',
      bare: false,
    });
  });

  it('should parse a detached-HEAD worktree with an empty branch', () => {
    // A detached worktree has no `branch refs/heads/...` line — git
    // emits a `detached` marker instead. The block must still be
    // returned (with branch === '') so it shows up in the sidebar.
    const output = [
      'worktree /home/user/repo',
      'HEAD abc123',
      'branch refs/heads/main',
      '',
      'worktree /home/user/repo/.claude/worktrees/master-test-temp',
      'HEAD f6d61737bd',
      'detached',
      '',
    ].join('\0');

    const result = parseWorktrees(output);
    expect(result).toHaveLength(2);
    expect(result[1]).toEqual({
      path: '/home/user/repo/.claude/worktrees/master-test-temp',
      branch: '',
      bare: false,
    });
  });

  it('should handle bare worktrees', () => {
    const output = ['worktree /home/user/repo', 'HEAD abc123', 'bare', ''].join(
      '\0'
    );

    const result = parseWorktrees(output);
    expect(result).toHaveLength(1);
    expect(result[0]!.bare).toBe(true);
    expect(result[0]!.branch).toBe('');
  });

  it('should return empty array for empty output', () => {
    expect(parseWorktrees('')).toEqual([]);
    expect(parseWorktrees('\n')).toEqual([]);
  });
});

describe('listWorktrees', () => {
  const cwd = process.cwd();

  it('should return only resolver-owned entries, excluding main worktree', async () => {
    mockExec.mockResolvedValueOnce(
      resolve(
        [
          `worktree ${cwd}`,
          'HEAD abc123',
          'branch refs/heads/main',
          '',
          `worktree ${cwd}/.claude/worktrees/feature-auth`,
          'HEAD def456',
          'branch refs/heads/feature/auth',
          '',
        ].join('\0')
      )
    );

    const result = await listWorktrees();
    expect(result).toHaveLength(1);
    expect(result[0]!.branch).toBe('feature/auth');
  });

  it('should filter out bare worktrees', async () => {
    mockExec.mockResolvedValueOnce(
      resolve(
        [
          `worktree ${cwd}`,
          'HEAD abc123',
          'bare',
          '',
          `worktree ${cwd}/.claude/worktrees/feature-auth`,
          'HEAD def456',
          'branch refs/heads/feature/auth',
          '',
        ].join('\0')
      )
    );

    const result = await listWorktrees();
    expect(result).toHaveLength(1);
    expect(result[0]!.branch).toBe('feature/auth');
  });

  it('should return empty array when git fails', async () => {
    mockExec.mockRejectedValueOnce(new Error('not a git repository'));
    expect(await listWorktrees()).toEqual([]);
  });

  it('should return empty array when no worktrees exist', async () => {
    mockExec.mockResolvedValueOnce(
      resolve(
        [`worktree ${cwd}`, 'HEAD abc123', 'branch refs/heads/main', ''].join(
          '\n'
        )
      )
    );

    expect(await listWorktrees()).toEqual([]);
  });

  it('should use custom resolver when set', async () => {
    setWorktreeResolver(
      createTemplateResolver('../{session}', '/repos/myrepo.git')
    );
    mockExec.mockResolvedValueOnce(
      resolve(
        [
          'worktree /repos/myrepo.git',
          'HEAD abc123',
          'bare',
          '',
          'worktree /repos/feature-auth',
          'HEAD def456',
          'branch refs/heads/feature/auth',
          '',
          'worktree /repos/fix-bug',
          'HEAD 789abc',
          'branch refs/heads/fix/bug',
          '',
          'worktree /other/unrelated',
          'HEAD 111222',
          'branch refs/heads/other',
          '',
        ].join('\0')
      )
    );

    const result = await listWorktrees();
    expect(result).toHaveLength(2);
    expect(result.map((w) => w.branch)).toEqual(['feature/auth', 'fix/bug']);
  });

  it('should not false-positive on prefix collisions', async () => {
    mockExec.mockResolvedValueOnce(
      resolve(
        [
          `worktree ${cwd}`,
          'HEAD abc123',
          'branch refs/heads/main',
          '',
          `worktree ${cwd}/.claude/worktrees-old/stale`,
          'HEAD def456',
          'branch refs/heads/stale',
          '',
          `worktree ${cwd}/.claude/worktrees/feature-auth`,
          'HEAD 789abc',
          'branch refs/heads/feature/auth',
          '',
        ].join('\0')
      )
    );

    const result = await listWorktrees();
    expect(result).toHaveLength(1);
    expect(result[0]!.branch).toBe('feature/auth');
  });

  it('should recover branch from rebase-merge for detached worktrees', async () => {
    const wtPath = `${cwd}/.claude/worktrees/feature-tables`;
    mockExec.mockResolvedValueOnce(
      resolve(
        [
          `worktree ${cwd}`,
          'HEAD abc123',
          'branch refs/heads/main',
          '',
          `worktree ${wtPath}`,
          'HEAD def456',
          'detached',
          '',
        ].join('\0')
      )
    );
    mockReadFileSync.mockImplementation(((p: string) => {
      if (p === `${wtPath}/.git`) {
        return `gitdir: ${cwd}/.git/worktrees/feature-tables\n`;
      }
      if (p === `${cwd}/.git/worktrees/feature-tables/rebase-merge/head-name`) {
        return 'refs/heads/feature/hmi-tables-component\n';
      }
      throw new Error(`ENOENT: ${p}`);
    }) as unknown as typeof readFileSync);

    const result = await listWorktrees();
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      path: wtPath,
      branch: 'feature/hmi-tables-component',
      bare: false,
      state: 'rebasing',
    });
  });

  it('should recover branch from rebase-apply when rebase-merge missing', async () => {
    const wtPath = `${cwd}/.claude/worktrees/feature-am`;
    mockExec.mockResolvedValueOnce(
      resolve([`worktree ${wtPath}`, 'HEAD def456', 'detached', ''].join('\0'))
    );
    mockReadFileSync.mockImplementation(((p: string) => {
      if (p === `${wtPath}/.git`) {
        return `gitdir: ${cwd}/.git/worktrees/feature-am\n`;
      }
      if (p.endsWith('/rebase-merge/head-name')) {
        throw new Error('ENOENT');
      }
      if (p === `${cwd}/.git/worktrees/feature-am/rebase-apply/head-name`) {
        return 'refs/heads/feature/am-flow\n';
      }
      throw new Error(`ENOENT: ${p}`);
    }) as unknown as typeof readFileSync);

    const result = await listWorktrees();
    expect(result).toHaveLength(1);
    expect(result[0]!.branch).toBe('feature/am-flow');
    expect(result[0]!.state).toBe('rebasing');
  });

  it('should keep true orphan detached worktrees with an empty branch', async () => {
    const orphan = `${cwd}/.claude/worktrees/master-test-temp`;
    const attached = `${cwd}/.claude/worktrees/feature-auth`;
    mockExec.mockResolvedValueOnce(
      resolve(
        [
          `worktree ${orphan}`,
          'HEAD abc123',
          'detached',
          '',
          `worktree ${attached}`,
          'HEAD def456',
          'branch refs/heads/feature/auth',
          '',
        ].join('\0')
      )
    );
    mockReadFileSync.mockImplementation(((p: string) => {
      if (p === `${orphan}/.git`) {
        return `gitdir: ${cwd}/.git/worktrees/master-test-temp\n`;
      }
      throw new Error(`ENOENT: ${p}`);
    }) as unknown as typeof readFileSync);

    // The orphan has no rebase in progress, so no branch is recovered.
    // It is still listed (branch: '') and gets its identity from the
    // directory basename via worktreeSessionName.
    const result = await listWorktrees();
    expect(result).toHaveLength(2);
    const orphanResult = result.find((w) => w.path === orphan);
    expect(orphanResult).toEqual({ path: orphan, branch: '', bare: false });
    expect(worktreeSessionName(orphanResult!)).toBe('master-test-temp');
    expect(result.find((w) => w.path === attached)!.branch).toBe(
      'feature/auth'
    );
  });
});

describe('rebaseOntoMaster', () => {
  it('should return success when fetch and rebase both succeed', async () => {
    mockExec
      .mockResolvedValueOnce(resolve('refs/remotes/origin/master')) // getMainBranch
      .mockResolvedValueOnce(resolve()) // fetch
      .mockResolvedValueOnce(resolve()); // rebase
    expect(await rebaseOntoMaster('/path/to/worktree')).toBe('success');
    expect(mockExec).toHaveBeenCalledTimes(3);
    expect(mockExec).toHaveBeenCalledWith(
      'git -C "/path/to/worktree" fetch origin master',
      { encoding: 'utf8' }
    );
    expect(mockExec).toHaveBeenCalledWith(
      'git -C "/path/to/worktree" rebase origin/master',
      { encoding: 'utf8' }
    );
  });

  it('should return error when fetch fails', async () => {
    mockExec
      .mockResolvedValueOnce(resolve('refs/remotes/origin/master')) // getMainBranch
      .mockRejectedValueOnce(new Error('fetch failed'));
    expect(await rebaseOntoMaster('/path/to/worktree')).toBe('error');
    expect(mockExec).toHaveBeenCalledTimes(2); // getMainBranch + fetch
  });

  it('should return conflict and abort when rebase fails', async () => {
    mockExec
      .mockResolvedValueOnce(resolve('refs/remotes/origin/master')) // getMainBranch
      .mockResolvedValueOnce(resolve()) // fetch succeeds
      .mockRejectedValueOnce(new Error('conflict')) // rebase fails
      .mockResolvedValueOnce(resolve()); // abort succeeds
    expect(await rebaseOntoMaster('/path/to/worktree')).toBe('conflict');
    expect(mockExec).toHaveBeenCalledTimes(4);
    expect(mockExec).toHaveBeenLastCalledWith(
      'git -C "/path/to/worktree" rebase --abort',
      { encoding: 'utf8' }
    );
  });

  it('should return conflict even when abort also fails', async () => {
    mockExec
      .mockResolvedValueOnce(resolve('refs/remotes/origin/master')) // getMainBranch
      .mockResolvedValueOnce(resolve()) // fetch succeeds
      .mockRejectedValueOnce(new Error('conflict')) // rebase fails
      .mockRejectedValueOnce(new Error('abort failed')); // abort fails
    expect(await rebaseOntoMaster('/path/to/worktree')).toBe('conflict');
    expect(mockExec).toHaveBeenCalledTimes(4);
  });
});

describe('fetchRemote', () => {
  it('should return true on success', async () => {
    mockExec.mockResolvedValueOnce(resolve());
    expect(await fetchRemote()).toBe(true);
    expect(mockExec).toHaveBeenCalledWith('git fetch --all --prune', {
      encoding: 'utf8',
    });
  });

  it('should return false when git fails', async () => {
    mockExec.mockRejectedValueOnce(new Error('network error'));
    expect(await fetchRemote()).toBe(false);
  });
});

describe('listAllBranches', () => {
  it('should return deduplicated local and remote branches', async () => {
    mockExec.mockResolvedValueOnce(
      resolve(
        'main\nfeature/auth\norigin/main\norigin/feature/auth\norigin/deploy\n'
      )
    );
    const branches = await listAllBranches();
    expect(branches).toEqual(['main', 'feature/auth', 'deploy']);
  });

  it('should filter out HEAD pointer', async () => {
    mockExec.mockResolvedValueOnce(resolve('main\norigin/HEAD\norigin/main\n'));
    expect(await listAllBranches()).toEqual(['main']);
  });

  it('should handle empty output', async () => {
    mockExec.mockResolvedValueOnce(resolve(''));
    expect(await listAllBranches()).toEqual([]);
  });

  it('should return empty array when git fails', async () => {
    mockExec.mockRejectedValueOnce(new Error('not a git repository'));
    expect(await listAllBranches()).toEqual([]);
  });
});

describe('getMainBranch', () => {
  it('should detect main branch from symbolic-ref', async () => {
    mockExec.mockResolvedValueOnce(resolve('refs/remotes/origin/master'));
    expect(await getMainBranch()).toBe('master');
    expect(mockExec).toHaveBeenCalledWith(
      'git symbolic-ref refs/remotes/origin/HEAD',
      { encoding: 'utf8' }
    );
  });

  it('should detect "main" from symbolic-ref', async () => {
    mockExec.mockResolvedValueOnce(resolve('refs/remotes/origin/main'));
    expect(await getMainBranch()).toBe('main');
  });

  it('should fall back to rev-parse when symbolic-ref fails', async () => {
    mockExec
      .mockRejectedValueOnce(new Error('no symbolic-ref'))
      .mockResolvedValueOnce(resolve());
    expect(await getMainBranch()).toBe('master');
    expect(mockExec).toHaveBeenCalledWith(
      'git rev-parse --verify --quiet origin/master',
      { encoding: 'utf8' }
    );
  });

  it('should default to "main" when both symbolic-ref and rev-parse fail', async () => {
    mockExec
      .mockRejectedValueOnce(new Error('no symbolic-ref'))
      .mockRejectedValueOnce(new Error('no origin/master'));
    expect(await getMainBranch()).toBe('main');
  });

  it('should return cached value on subsequent calls', async () => {
    mockExec.mockResolvedValueOnce(resolve('refs/remotes/origin/master'));
    await getMainBranch();
    // Second call should not invoke exec again
    expect(await getMainBranch()).toBe('master');
    expect(mockExec).toHaveBeenCalledTimes(1);
  });
});

describe('fastForwardMainBranch', () => {
  it('should use branch -f when HEAD is not on main branch', async () => {
    mockExec
      .mockResolvedValueOnce(resolve('refs/remotes/origin/master')) // getMainBranch
      .mockResolvedValueOnce(resolve()) // fetch
      .mockResolvedValueOnce(resolve('feature/foo\n')) // symbolic-ref HEAD
      .mockResolvedValueOnce(resolve()); // branch -f
    expect(await fastForwardMainBranch()).toBe(true);
    expect(mockExec).toHaveBeenCalledWith('git fetch origin master', {
      encoding: 'utf8',
    });
    expect(mockExec).toHaveBeenCalledWith('git symbolic-ref --short HEAD', {
      encoding: 'utf8',
    });
    expect(mockExec).toHaveBeenCalledWith(
      'git branch -f master origin/master',
      { encoding: 'utf8' }
    );
  });

  it('should use merge --ff-only when HEAD IS on main branch', async () => {
    mockExec
      .mockResolvedValueOnce(resolve('refs/remotes/origin/master')) // getMainBranch
      .mockResolvedValueOnce(resolve()) // fetch
      .mockResolvedValueOnce(resolve('master\n')) // symbolic-ref HEAD
      .mockResolvedValueOnce(resolve()); // merge --ff-only
    expect(await fastForwardMainBranch()).toBe(true);
    expect(mockExec).toHaveBeenCalledWith('git merge --ff-only origin/master', {
      encoding: 'utf8',
    });
  });

  it('should return false when fetch fails', async () => {
    mockExec
      .mockResolvedValueOnce(resolve('refs/remotes/origin/master')) // getMainBranch
      .mockRejectedValueOnce(new Error('fetch failed'));
    expect(await fastForwardMainBranch()).toBe(false);
    expect(mockExec).toHaveBeenCalledTimes(2); // getMainBranch + fetch
  });

  it('should return false when branch update fails', async () => {
    mockExec
      .mockResolvedValueOnce(resolve('refs/remotes/origin/master')) // getMainBranch
      .mockResolvedValueOnce(resolve()) // fetch
      .mockResolvedValueOnce(resolve('feature/foo\n')) // symbolic-ref HEAD
      .mockRejectedValueOnce(new Error('branch update failed'));
    expect(await fastForwardMainBranch()).toBe(false);
  });

  it('should return false when HEAD is detached and branch -f fails', async () => {
    mockExec
      .mockResolvedValueOnce(resolve('refs/remotes/origin/master')) // getMainBranch
      .mockResolvedValueOnce(resolve()) // fetch
      .mockRejectedValueOnce(new Error('not a symbolic ref')); // symbolic-ref HEAD fails (detached)
    expect(await fastForwardMainBranch()).toBe(false);
  });
});

describe('countConflicts', () => {
  it('should return 0 for clean merge', async () => {
    mockExec
      .mockResolvedValueOnce(resolve('refs/remotes/origin/master')) // getMainBranch
      .mockResolvedValueOnce(resolve('abc123'));
    expect(await countConflicts('feature/clean')).toBe(0);
    expect(mockExec).toHaveBeenCalledWith(
      'git merge-tree --write-tree origin/master "feature/clean"',
      { encoding: 'utf8' }
    );
  });

  it('should count CONFLICT lines from exit code 1', async () => {
    const err = new Error('merge conflict') as Error & {
      code: number;
      stdout: string;
    };
    err.code = 1;
    err.stdout = [
      'abc123',
      'CONFLICT (content): Merge conflict in src/file1.ts',
      'CONFLICT (content): Merge conflict in src/file2.ts',
      '',
    ].join('\n');
    mockExec
      .mockResolvedValueOnce(resolve('refs/remotes/origin/master')) // getMainBranch
      .mockRejectedValueOnce(err);
    expect(await countConflicts('feature/conflicts')).toBe(2);
  });

  it('cannot check when a ref is not something git can merge', async () => {
    // git exits 1 for this too, but with nothing on stdout: an
    // unfetched tracking branch must not read as a clean merge.
    const err = new Error('not something we can merge') as Error & {
      code: number;
      stdout: string;
    };
    err.code = 1;
    err.stdout = '';
    mockExec.mockRejectedValueOnce(err);
    expect(
      await countConflictsBetween('origin/main', 'origin/feat')
    ).toBeNull();
  });

  it('should return 0 for non-conflict errors', async () => {
    mockExec
      .mockResolvedValueOnce(resolve('refs/remotes/origin/master')) // getMainBranch
      .mockRejectedValueOnce(new Error('unknown error'));
    expect(await countConflicts('feature/broken')).toBe(0);
  });

  it('should return 0 when exit code is 1 but no CONFLICT lines', async () => {
    const err = new Error('merge issue') as Error & {
      code: number;
      stdout: string;
    };
    err.code = 1;
    err.stdout = 'abc123\n';
    mockExec
      .mockResolvedValueOnce(resolve('refs/remotes/origin/master')) // getMainBranch
      .mockRejectedValueOnce(err);
    expect(await countConflicts('feature/weird')).toBe(0);
  });
});

describe('branchToSessionName', () => {
  it('should replace slashes with hyphens', () => {
    expect(branchToSessionName('feature/auth')).toBe('feature-auth');
  });

  it('should handle multiple slashes', () => {
    expect(branchToSessionName('feat/ui/sidebar')).toBe('feat-ui-sidebar');
  });

  it('should return names without slashes unchanged', () => {
    expect(branchToSessionName('main')).toBe('main');
  });

  it('should handle empty string', () => {
    expect(branchToSessionName('')).toBe('');
  });
});

describe('worktreeSessionName', () => {
  it('uses the branch-derived name when a branch is present', () => {
    expect(
      worktreeSessionName({
        path: '/repo/.claude/worktrees/feature-auth',
        branch: 'feature/auth',
        bare: false,
      })
    ).toBe('feature-auth');
  });

  it('falls back to the directory name for a detached worktree', () => {
    expect(
      worktreeSessionName({
        path: '/repo/.claude/worktrees/master-test-temp',
        branch: '',
        bare: false,
      })
    ).toBe('master-test-temp');
  });
});

describe('WorktreeResolver', () => {
  describe('default resolver', () => {
    it('dir() matches existing worktreeDir behavior', () => {
      // default resolver is active after resetWorktreeResolver in beforeEach
      // We test indirectly via createWorktree which calls worktreeDir
      // Just verify branchToSessionName is used consistently
      expect(branchToSessionName('feature/auth')).toBe('feature-auth');
    });

    it('owns() uses startsWith and rejects paths outside base', () => {
      const cwd = process.cwd();
      const base = pathResolve(cwd, '.claude/worktrees');
      // The default resolver should own paths under .claude/worktrees
      // We test via listWorktrees behavior (tested above)
      // Here we test createTemplateResolver as a proxy for the pattern
      const resolver = createTemplateResolver(
        '.claude/worktrees/{session}',
        cwd
      );
      expect(resolver.owns(`${base}/feature-auth`)).toBe(true);
      expect(resolver.owns(base)).toBe(true);
      expect(resolver.owns(`${base}-old/stale`)).toBe(false);
      expect(resolver.owns('/completely/different/path')).toBe(false);
    });

    it('base() is the directory owns() tests membership of', () => {
      expect(worktreesBasePath()).toBe(
        pathResolve(process.cwd(), '.claude/worktrees')
      );
    });
  });

  describe('createTemplateResolver', () => {
    it('base() strips the template placeholder tail', () => {
      setWorktreeResolver(
        createTemplateResolver('../trees/{session}', '/repos/myrepo')
      );
      expect(worktreesBasePath()).toBe('/repos/trees');
    });

    it('with ../{session} produces sibling paths', () => {
      const resolver = createTemplateResolver(
        '../{session}',
        '/repos/myrepo.git'
      );
      expect(resolver.dir('feature/auth')).toBe('../feature-auth');
      expect(resolver.dir('main')).toBe('../main');
    });

    it('with {branch} preserves slashes', () => {
      const resolver = createTemplateResolver(
        'worktrees/{branch}',
        '/repos/myrepo'
      );
      expect(resolver.dir('feature/auth')).toBe('worktrees/feature/auth');
    });

    it('owns() derives base from template', () => {
      const resolver = createTemplateResolver(
        '../{session}',
        '/repos/myrepo.git'
      );
      // base = resolve('/repos/myrepo.git', '..') = '/repos'
      expect(resolver.owns('/repos/feature-auth')).toBe(true);
      expect(resolver.owns('/repos')).toBe(true);
      expect(resolver.owns('/repos-other/foo')).toBe(false);
      expect(resolver.owns('/other/path')).toBe(false);
    });

    it('owns() handles absolute template paths', () => {
      const resolver = createTemplateResolver(
        '/custom/worktrees/{session}',
        '/any'
      );
      expect(resolver.owns('/custom/worktrees/feature-auth')).toBe(true);
      expect(resolver.owns('/custom/worktrees')).toBe(true);
      expect(resolver.owns('/custom/other')).toBe(false);
    });

    it('with default-like template matches default resolver behavior', () => {
      const cwd = process.cwd();
      const resolver = createTemplateResolver(
        '.claude/worktrees/{session}',
        cwd
      );
      const base = pathResolve(cwd, '.claude/worktrees');
      expect(resolver.owns(`${base}/feature-auth`)).toBe(true);
      expect(resolver.owns(`${base}-old/stale`)).toBe(false);
    });
  });

  describe('owns() and the separator git reports', () => {
    // `git worktree list --porcelain` reports forward slashes on every
    // platform, while `path.resolve` gives backslashes on Windows. When
    // owns() compared those literally, every worktree looked unowned and
    // listWorktrees() returned nothing at all on Windows.
    it('accepts the path shape git emits for a base path from resolve()', () => {
      resetWorktreeResolver();
      const base = worktreesBasePath();
      const asGitReportsIt = base.replace(/\\/g, '/') + '/feature-auth';
      expect(ownsWorktreePath(asGitReportsIt)).toBe(true);
    });

    it('still rejects a sibling directory whose name shares the prefix', () => {
      resetWorktreeResolver();
      const base = worktreesBasePath().replace(/\\/g, '/');
      expect(ownsWorktreePath(base + '-old/stale')).toBe(false);
    });

    it('is case-insensitive on Windows only', () => {
      resetWorktreeResolver();
      const base = worktreesBasePath().replace(/\\/g, '/');
      const shouted = base.toUpperCase() + '/FEATURE-AUTH';
      expect(ownsWorktreePath(shouted)).toBe(process.platform === 'win32');
    });
  });

  describe('judging ownership for a named repository', () => {
    // A caller acting on a repository it was handed cannot rely on the
    // process's directory: the desktop chdir()s between its awaits.
    it('answers about the given repository, not the process one', () => {
      resetWorktreeResolver();
      const elsewhere = pathResolve('/repos/elsewhere');
      const theirs = `${elsewhere.replace(/\\/g, '/')}/.claude/worktrees/x`;
      expect(ownsWorktreePath(theirs, elsewhere)).toBe(true);
      expect(ownsWorktreePath(theirs)).toBe(false);
    });

    it('re-resolves a relative template against the repository asked about', () => {
      // '../{session}' is a sibling of whichever checkout is asking, so
      // the base captured at creation is the wrong answer for another.
      setWorktreeResolver(
        createTemplateResolver('../{session}', pathResolve('/repos/one'))
      );
      expect(worktreesBasePath()).toBe(pathResolve('/repos'));
      expect(worktreesBasePath(pathResolve('/elsewhere/two'))).toBe(
        pathResolve('/elsewhere')
      );
      const theirs = `${pathResolve('/elsewhere').replace(
        /\\/g,
        '/'
      )}/feature-auth`;
      expect(ownsWorktreePath(theirs, pathResolve('/elsewhere/two'))).toBe(
        true
      );
      expect(ownsWorktreePath(theirs)).toBe(false);
    });

    it('leaves an absolute template alone whichever repository asks', () => {
      const shared = pathResolve('/custom/worktrees');
      setWorktreeResolver(
        createTemplateResolver(`${shared}/{session}`, pathResolve('/repos/one'))
      );
      expect(worktreesBasePath(pathResolve('/repos/two'))).toBe(shared);
      expect(
        ownsWorktreePath(
          `${shared.replace(/\\/g, '/')}/feature-auth`,
          pathResolve('/repos/two')
        )
      ).toBe(true);
    });
  });
});

describe('shell-safety guard for refs', () => {
  it('accepts ordinary branch names', () => {
    for (const ok of [
      'main',
      'feature/add-thing',
      'release-1.2.3',
      'user.name/fix_bug',
      'ünicode-brañch',
    ]) {
      expect(() => assertShellSafeRef(ok)).not.toThrow();
    }
  });

  // git check-ref-format permits all of these, but the shell acts on
  // them once a ref is interpolated into a command string.
  it('rejects refs carrying shell metacharacters', () => {
    for (const bad of [
      'evil`id`',
      'evil$(id)',
      'evil$HOME',
      'evil"; id; "',
      "evil'x",
      'a&&b',
      'a|b',
      'a;b',
      'a>b',
      'a\nb',
    ]) {
      expect(() => assertShellSafeRef(bad)).toThrow(/unsafe branch name/);
    }
  });

  it('names what it rejected', () => {
    expect(() => assertShellSafeRef('/tmp/x`id`', 'worktree path')).toThrow(
      /unsafe worktree path name/
    );
  });

  it('is enforced by the operations that shell out', async () => {
    await expect(createWorktree('evil`id`')).rejects.toThrow(/unsafe/);
    await expect(deleteBranch('evil`id`', true)).rejects.toThrow(/unsafe/);
    await expect(countConflicts('evil`id`')).rejects.toThrow(/unsafe/);
    await expect(canRemoveBranch('evil`id`')).rejects.toThrow(/unsafe/);
    await expect(removeWorktree('evil`id`')).rejects.toThrow(/unsafe/);
  });
});

/**
 * The one thing that must not happen (root AGENTS.md, this package's
 * own): a function handed a remote machine that quietly acts on the
 * local repository instead. Every test below asserts the *negative* —
 * `mockExec` (the local `child_process.exec` path) is never called
 * once a remote machine is in play — so a regression that reintroduces
 * a local fallback fails here even if the remote path also happens to
 * "work" by coincidence.
 */
describe('the machine seam (D5): remote-aware functions, and explicit failure for the rest', () => {
  function fakeMachine(
    handler: (
      argv: string[],
      cwd?: string
    ) => { stdout: string; stderr: string; code: number }
  ): { machine: Machine; calls: { argv: string[]; cwd?: string }[] } {
    const calls: { argv: string[]; cwd?: string }[] = [];
    const executor: MachineExecutor = {
      async run(argv, opts) {
        calls.push({ argv, cwd: opts?.cwd });
        return handler(argv, opts?.cwd);
      },
    };
    return { machine: { id: 'peer-abc', executor }, calls };
  }

  describe('createWorktree', () => {
    it('creates the worktree on the remote machine via its executor, never touching local exec', async () => {
      const { machine, calls } = fakeMachine((argv) => {
        if (argv.join(' ') === 'git worktree list --porcelain -z')
          return { stdout: '', stderr: '', code: 0 };
        return { stdout: '', stderr: '', code: 0 };
      });
      const result = await createWorktree('feature/auth', '/repo', machine);
      expect(result).toBe('/repo/.claude/worktrees/feature-auth');
      expect(mockExec).not.toHaveBeenCalled();
      expect(calls[0]!.argv).toEqual([
        'git',
        'worktree',
        'list',
        '--porcelain',
        '-z',
      ]);
      expect(calls[0]!.cwd).toBe('/repo');
      expect(calls[1]!.argv).toEqual([
        'git',
        'worktree',
        'add',
        '.claude/worktrees/feature-auth',
        'feature/auth',
      ]);
    });

    it('falls back to -b remotely exactly as locally, without ever calling local exec', async () => {
      let attempts = 0;
      const { machine } = fakeMachine((argv) => {
        if (argv.includes('list')) return { stdout: '', stderr: '', code: 0 };
        if (argv.includes('add') && !argv.includes('-b')) {
          attempts += 1;
          return { stdout: '', stderr: 'branch not found', code: 1 };
        }
        return { stdout: '', stderr: '', code: 0 };
      });
      const result = await createWorktree('new-branch', '/repo', machine);
      expect(result).toBe('/repo/.claude/worktrees/new-branch');
      expect(attempts).toBe(1);
      expect(mockExec).not.toHaveBeenCalled();
    });

    it('reuses an existing remote worktree without attempting a second create', async () => {
      const { machine, calls } = fakeMachine((argv) => {
        if (argv.join(' ') === 'git worktree list --porcelain -z')
          return {
            stdout: `worktree /repo/.claude/worktrees/feature-auth\0branch refs/heads/feature/auth\0\0`,
            stderr: '',
            code: 0,
          };
        return { stdout: '', stderr: '', code: 0 };
      });
      const result = await createWorktree('feature/auth', '/repo', machine);
      expect(result).toBe('/repo/.claude/worktrees/feature-auth');
      expect(calls).toHaveLength(1);
      expect(mockExec).not.toHaveBeenCalled();
    });
  });

  describe('removeWorktree', () => {
    it('removes the worktree on the remote machine, never touching local exec', async () => {
      const { machine, calls } = fakeMachine((argv) => {
        if (argv.join(' ') === 'git worktree list --porcelain -z')
          return {
            stdout: `worktree /repo/.claude/worktrees/feature-auth\0branch refs/heads/feature/auth\0\0`,
            stderr: '',
            code: 0,
          };
        return { stdout: '', stderr: '', code: 0 };
      });
      const ok = await removeWorktree('feature/auth', {
        cwd: '/repo',
        machine,
      });
      expect(ok).toBe(true);
      expect(mockExec).not.toHaveBeenCalled();
      expect(calls[1]!.argv).toEqual([
        'git',
        'worktree',
        'remove',
        '/repo/.claude/worktrees/feature-auth',
      ]);
    });

    it('reports failure rather than silently succeeding when the remote git call fails', async () => {
      const { machine } = fakeMachine((argv) => {
        if (argv.join(' ') === 'git worktree list --porcelain -z')
          return {
            stdout: `worktree /repo/.claude/worktrees/feature-auth\0branch refs/heads/feature/auth\0\0`,
            stderr: '',
            code: 0,
          };
        return { stdout: '', stderr: 'worktree is dirty', code: 1 };
      });
      const ok = await removeWorktree('feature/auth', {
        cwd: '/repo',
        machine,
      });
      expect(ok).toBe(false);
      expect(mockExec).not.toHaveBeenCalled();
    });

    it('answers false, without touching local exec, when the branch has no worktree on that machine', async () => {
      const { machine } = fakeMachine(() => ({
        stdout: '',
        stderr: '',
        code: 0,
      }));
      const ok = await removeWorktree('feature/auth', {
        cwd: '/repo',
        machine,
      });
      expect(ok).toBe(false);
      expect(mockExec).not.toHaveBeenCalled();
    });
  });

  describe('the no-silent-fallback rule for functions this phase left local-only', () => {
    it('checkoutWorktree throws rather than checking out locally for a remote machine', async () => {
      const { machine } = fakeMachine(() => ({
        stdout: '',
        stderr: '',
        code: 0,
      }));
      await expect(
        checkoutWorktree('feature/auth', '/repo', machine)
      ).rejects.toThrow(/does not support a remote machine/);
      expect(mockExec).not.toHaveBeenCalled();
    });

    it('canRemoveBranch throws rather than judging local state for a remote machine', async () => {
      const { machine } = fakeMachine(() => ({
        stdout: '',
        stderr: '',
        code: 0,
      }));
      await expect(
        canRemoveBranch('feature/auth', false, machine)
      ).rejects.toThrow(/does not support a remote machine/);
      expect(mockExec).not.toHaveBeenCalled();
    });

    it('rebaseOntoMaster throws rather than rebasing the local checkout for a remote machine', async () => {
      const { machine } = fakeMachine(() => ({
        stdout: '',
        stderr: '',
        code: 0,
      }));
      await expect(rebaseOntoMaster('/repo/wt', machine)).rejects.toThrow(
        /does not support a remote machine/
      );
      expect(mockExec).not.toHaveBeenCalled();
    });

    it('a "local" machine id is treated as local, not routed through the executor', async () => {
      const executor: MachineExecutor = {
        run: vi.fn(async () => ({ stdout: '', stderr: '', code: 0 })),
      };
      mockExec.mockResolvedValueOnce(worktreeListPorcelain([]));
      mockExec.mockResolvedValueOnce(resolve());
      await createWorktree('feature/auth', '/repo', { id: 'local', executor });
      expect(executor.run).not.toHaveBeenCalled();
      expect(mockExec).toHaveBeenCalled();
    });
  });
});
