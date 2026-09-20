import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLAUDE_CONFIG_DIR_ENV } from '../agents/agent-config-dirs.js';
import { machineEnvAdditions } from './machine-env.js';

const registered = vi.hoisted(() => ({ dirs: [] as string[] }));

vi.mock('@n10/vcs-core', () => ({
  readGlobalConfig: () => ({ claudeConfigDirs: registered.dirs }),
}));

describe('machineEnvAdditions', () => {
  beforeEach(() => {
    registered.dirs = ['~/.claude-work'];
  });

  it('contributes nothing when the launch asks for nothing', () => {
    expect(machineEnvAdditions(undefined, '/tmp', 'claude')).toEqual({});
    expect(machineEnvAdditions({}, '/tmp', 'claude')).toEqual({});
  });

  it('resolves the selected config directory on this machine', () => {
    expect(
      machineEnvAdditions({ configDir: '~/.claude-work' }, '/tmp', 'claude')
    ).toEqual({ [CLAUDE_CONFIG_DIR_ENV]: `${homedir()}/.claude-work` });
  });

  it('sends nothing to a machine that is not this one', () => {
    // A remote host has its own home, credentials and registered
    // directories. Forwarding this machine's answer is the bug; sending
    // nothing and letting that host default is the intended behaviour.
    expect(
      machineEnvAdditions(
        { configDir: '~/.claude-work', local: false },
        '/tmp',
        'claude'
      )
    ).toEqual({});
  });

  it('leaves the variable alone for an agent that does not read it', () => {
    // CLAUDE_CONFIG_DIR means nothing to codex; setting it would be
    // noise crossing to whichever machine runs the session.
    expect(
      machineEnvAdditions({ configDir: '~/.claude-work' }, '/tmp', 'codex')
    ).toEqual({});
  });
});

describe('machineEnvAdditions with an isolated git index', () => {
  let repo: string;

  beforeEach(() => {
    registered.dirs = [];
    repo = mkdtempSync(join(tmpdir(), 'n10-machine-env-'));
    const git = (...args: string[]) =>
      execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
    git('init', '-q');
    git('config', 'user.email', 'a@b.c');
    git('config', 'user.name', 'Test');
    writeFileSync(join(repo, 'tracked.txt'), 'hello\n');
    git('add', 'tracked.txt');
    git('commit', '-qm', 'first');
  });

  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it('suppresses optional locks and hands over a private index', () => {
    const env = machineEnvAdditions({ isolateGitIndex: true }, repo, 'claude');
    expect(env.GIT_OPTIONAL_LOCKS).toBe('0');
    expect(env.GIT_INDEX_FILE).toBeTruthy();
    expect(env.GIT_INDEX_FILE).not.toBe(join(repo, '.git', 'index'));
  });

  it('copies the worktree index rather than starting an empty one', () => {
    // An empty scratch index would make every tracked file read as
    // newly added, so the review would report the whole tree as a diff.
    const env = machineEnvAdditions({ isolateGitIndex: true }, repo, 'claude');
    const listed = execFileSync('git', ['ls-files'], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, ...env },
    });
    expect(listed.trim()).toBe('tracked.txt');
  });

  it('keeps writes off the shared index', () => {
    const shared = readFileSync(join(repo, '.git', 'index'));
    const env = machineEnvAdditions({ isolateGitIndex: true }, repo, 'claude');
    writeFileSync(join(repo, 'extra.txt'), 'x\n');
    execFileSync('git', ['add', 'extra.txt'], {
      cwd: repo,
      stdio: 'ignore',
      env: { ...process.env, ...env },
    });
    expect(readFileSync(join(repo, '.git', 'index')).equals(shared)).toBe(true);
    expect(
      execFileSync('git', ['ls-files'], {
        cwd: repo,
        encoding: 'utf8',
        env: { ...process.env, ...env },
      })
    ).toContain('extra.txt');
  });

  it('degrades to lock suppression when there is no index to copy', () => {
    const bare = mkdtempSync(join(tmpdir(), 'n10-machine-env-nogit-'));
    try {
      expect(
        machineEnvAdditions({ isolateGitIndex: true }, bare, 'claude')
      ).toEqual({ GIT_OPTIONAL_LOCKS: '0' });
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });
});
