import { describe, expect, it } from 'vitest';
import {
  CLAUDE_CONFIG_DIR_ENV,
  DEFAULT_CONFIG_DIR,
  configDirEnv,
  configDirOptions,
  expandConfigDir,
  isMachineLocalConfigDir,
  normalizeConfigDir,
} from './agent-config-dirs.js';

const HOME = '/home/ada';

describe('normalizeConfigDir', () => {
  it('keeps a home-relative token as written', () => {
    expect(normalizeConfigDir('~/.claude-work', HOME)).toBe('~/.claude-work');
  });

  it('rewrites an absolute path under HOME to a home-relative token', () => {
    // The whole point of the indirection: what the user typed describes
    // this machine, what is stored must describe any machine.
    expect(normalizeConfigDir('/home/ada/.claude-work', HOME)).toBe(
      '~/.claude-work'
    );
  });

  it('keeps an absolute path outside HOME, marked machine-local', () => {
    const token = normalizeConfigDir('/srv/shared/claude', HOME);
    expect(token).toBe('/srv/shared/claude');
    expect(isMachineLocalConfigDir(token!)).toBe(true);
  });

  it('treats a home-relative token as portable', () => {
    expect(isMachineLocalConfigDir('~/.claude-work')).toBe(false);
  });

  it('strips trailing slashes and normalizes traversal', () => {
    expect(normalizeConfigDir('/home/ada/work/../.claude-x/', HOME)).toBe(
      '~/.claude-x'
    );
  });

  it('rejects input with nothing to anchor it', () => {
    expect(normalizeConfigDir('.claude-work', HOME)).toBeNull();
    expect(normalizeConfigDir('   ', HOME)).toBeNull();
    expect(normalizeConfigDir('~', HOME)).toBeNull();
    expect(normalizeConfigDir('~/..', HOME)).toBeNull();
    expect(normalizeConfigDir(HOME, HOME)).toBeNull();
  });
});

describe('configDirOptions', () => {
  it('always offers the default first', () => {
    expect(configDirOptions(undefined, HOME)).toEqual([DEFAULT_CONFIG_DIR]);
  });

  it('normalizes, deduplicates and keeps registration order', () => {
    expect(
      configDirOptions(
        ['/home/ada/.claude-work', '~/.claude-work', '/home/ada/.claude'],
        HOME
      )
    ).toEqual([DEFAULT_CONFIG_DIR, '~/.claude-work']);
  });

  it('drops entries that cannot be anchored', () => {
    expect(configDirOptions(['relative/dir', ''], HOME)).toEqual([
      DEFAULT_CONFIG_DIR,
    ]);
  });
});

describe('expandConfigDir', () => {
  it('resolves a token against the machine that will run the agent', () => {
    expect(expandConfigDir('~/.claude-work', '/home/ada')).toBe(
      '/home/ada/.claude-work'
    );
    expect(expandConfigDir('~/.claude-work', '/home/grace')).toBe(
      '/home/grace/.claude-work'
    );
  });

  it('leaves a machine-local path alone', () => {
    expect(expandConfigDir('/srv/shared/claude', HOME)).toBe(
      '/srv/shared/claude'
    );
  });
});

describe('configDirEnv', () => {
  it('sets nothing when no directory was selected', () => {
    // Unset means "let the host decide" — never "use whatever this
    // process inherited, forwarded to wherever the agent runs".
    expect(configDirEnv(undefined, ['~/.claude-work'], HOME)).toEqual({});
  });

  it('expands the selected token on this machine', () => {
    expect(configDirEnv('~/.claude-work', ['~/.claude-work'], HOME)).toEqual({
      [CLAUDE_CONFIG_DIR_ENV]: '/home/ada/.claude-work',
    });
  });

  it('answers for the default without it being registered', () => {
    expect(configDirEnv(DEFAULT_CONFIG_DIR, undefined, HOME)).toEqual({
      [CLAUDE_CONFIG_DIR_ENV]: '/home/ada/.claude',
    });
  });

  it('defers when the token is not registered here', () => {
    // A machine answers for its own directories; it does not invent a
    // path for a name another machine registered.
    expect(configDirEnv('~/.claude-other', ['~/.claude-work'], HOME)).toEqual(
      {}
    );
  });
});
