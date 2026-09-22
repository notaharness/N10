import { homedir } from 'node:os';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
    expect(machineEnvAdditions(undefined, 'claude')).toEqual({});
    expect(machineEnvAdditions({}, 'claude')).toEqual({});
  });

  it('resolves the selected config directory on this machine', () => {
    expect(
      machineEnvAdditions({ configDir: '~/.claude-work' }, 'claude')
    ).toEqual({ [CLAUDE_CONFIG_DIR_ENV]: `${homedir()}/.claude-work` });
  });

  it('sends nothing to a machine that is not this one', () => {
    // A remote host has its own home, credentials and registered
    // directories. Forwarding this machine's answer is the bug; sending
    // nothing and letting that host default is the intended behaviour.
    expect(
      machineEnvAdditions(
        { configDir: '~/.claude-work', local: false },
        'claude'
      )
    ).toEqual({});
  });

  it('leaves the variable alone for an agent that does not read it', () => {
    // CLAUDE_CONFIG_DIR means nothing to codex; setting it would be
    // noise crossing to whichever machine runs the session.
    expect(
      machineEnvAdditions({ configDir: '~/.claude-work' }, 'codex')
    ).toEqual({});
  });
});
