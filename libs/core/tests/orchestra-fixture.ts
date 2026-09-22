import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { vi } from 'vitest';
import { killAll } from '../src/lib/pty-registry.js';

const fixtures = fileURLToPath(new URL('./fixtures/', import.meta.url));
const archiveHash =
  '8f2203443b94cecfc86e31b0aecb5f3d1329fa3612530fd16c30d24ba72d44d5';

/** One plugin install, repository and tmux server per test. */
export function orchestraFixture() {
  const home = mkdtempSync(join(tmpdir(), 'n10-orchestra-'));
  const repo = join(home, 'shop');
  const socketDir = join(home, 'tmux');
  const pluginDir = join(home, '.claude/plugins');
  const bin = join(home, 'bin');
  for (const dir of [repo, socketDir, pluginDir, bin])
    mkdirSync(dir, { recursive: true });
  const archive = readFileSync(join(fixtures, 'orchestra.tar.gz'));
  if (createHash('sha256').update(archive).digest('hex') !== archiveHash) {
    throw new Error('Orchestra fixture checksum mismatch');
  }
  execFileSync('tar', [
    '-xzf',
    join(fixtures, 'orchestra.tar.gz'),
    '-C',
    pluginDir,
  ]);
  for (const agent of ['codex', 'claude']) {
    writeFileSync(
      join(bin, agent),
      `#!${process.execPath}\n` +
        readFileSync(join(fixtures, 'fake-orchestra-agent.mjs')),
      { mode: 0o755 }
    );
  }
  writeFileSync(join(bin, 'package.json'), JSON.stringify({ type: 'module' }));
  writeFileSync(
    join(home, '.tmux.conf'),
    'set-option -g default-shell /bin/sh\n'
  );
  vi.stubEnv('HOME', home);
  vi.stubEnv('TMUX_TMPDIR', socketDir);
  vi.stubEnv('TMUX', undefined);
  vi.stubEnv('TMUX_PANE', undefined);
  for (const key of [
    'ORCH_REPO',
    'ORCHESTRA_SESSION',
    'ORCHESTRA_SOCKET',
    'GIT_DIR',
    'GIT_WORK_TREE',
    'GIT_COMMON_DIR',
    'GIT_INDEX_FILE',
    'GIT_CONFIG_COUNT',
    'GIT_CONFIG_PARAMETERS',
    // A launch adds this only when a directory was chosen, but a
    // session inherits the rest of its environment — so a developer
    // who exports one would see it arrive and read that as n10 having
    // sent it. Scrubbed so "nothing was added" is observable.
    'CLAUDE_CONFIG_DIR',
  ])
    vi.stubEnv(key, undefined);
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  vi.stubEnv('GIT_CONFIG_GLOBAL', join(home, '.gitconfig'));
  vi.stubEnv('XDG_CONFIG_HOME', join(home, '.config'));
  vi.stubEnv('PATH', `${bin}:${process.env.PATH}`);
  const run = (command: string, args: string[]) =>
    execFileSync(command, args, {
      cwd: repo,
      encoding: 'utf8',
      timeout: 15_000,
    });
  const assertIsolated = () => {
    if (
      process.env.TMUX ||
      process.env.TMUX_TMPDIR !== socketDir ||
      process.env.HOME !== home
    )
      throw new Error('Unsafe tmux fixture environment');
  };
  const tmux = (...args: string[]) => {
    assertIsolated();
    return run('tmux', args).trim();
  };
  run('git', ['init', '-b', 'main']);
  run('git', [
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.test',
    'commit',
    '--allow-empty',
    '-m',
    'fixture',
  ]);
  tmux('new-session', '-d', '-s', 'fixture-anchor', 'sleep', '300');
  const scriptPath = (name: string) =>
    join(pluginDir, 'orchestra/skills/orchestrator/scripts', name);
  return {
    home,
    repo,
    plugin: join(pluginDir, 'orchestra'),
    tmux,
    script: (name: string, ...args: string[]) => {
      assertIsolated();
      return spawnSync('bash', [scriptPath(name), ...args], {
        cwd: repo,
        encoding: 'utf8',
        timeout: 15_000,
      });
    },
    read: (name: string) => readFileSync(join(home, name), 'utf8'),
    close: () => {
      try {
        killAll();
        // Only this fixture's server; the last individually killed
        // session shuts it down. Never kill-server, even on a scratch
        // socket. `list-sessions` throws (execFileSync) when the server
        // is already gone — nothing left to kill, not a fixture failure.
        // That is the only failure this scopes to: assertIsolated()
        // (inside every `tmux(...)` call, including this one) must keep
        // throwing through, or a lost isolation guarantee — $TMUX
        // reappearing, HOME/TMUX_TMPDIR drifting — would be swallowed
        // and this fixture's own sessions left running unnoticed.
        let names: string[] = [];
        try {
          names = tmux('list-sessions', '-F', '#{session_name}')
            .split('\n')
            .filter(Boolean);
        } catch (error) {
          if (!/no server running/.test(String(error))) throw error;
        }
        for (const name of names) tmux('kill-session', '-t', `=${name}:`);
      } finally {
        vi.unstubAllEnvs();
        rmSync(home, { recursive: true, force: true });
      }
    },
  };
}
