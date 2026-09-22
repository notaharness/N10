import { beforeEach, describe, expect, it, vi } from 'vitest';
import { homedir } from 'node:os';

/**
 * The global config file itself is core's to own; this suite only
 * checks the service's own logic — normalizing input, deduplicating
 * against what is already registered, and refusing to drop the
 * default — so it stubs `@n10/vcs-core`'s store with an in-memory bag.
 */

const state = vi.hoisted(() => ({
  config: {} as { claudeConfigDirs?: string[] },
}));

vi.mock('@n10/vcs-core', () => ({
  readGlobalConfig: () => state.config,
  writeGlobalConfig: (next: { claudeConfigDirs?: string[] }) => {
    state.config = next;
  },
}));

const { listAgentConfigDirs, registerAgentConfigDir, forgetAgentConfigDir } =
  await import('./agent-config-dirs.js');

describe('agent config dirs', () => {
  beforeEach(() => {
    state.config = {};
  });

  it('always lists the default first, even with nothing registered', () => {
    expect(listAgentConfigDirs()).toEqual(['~/.claude']);
  });

  it('registers a new directory as a token', () => {
    const result = registerAgentConfigDir('~/.claude-work');
    expect(result).toEqual(['~/.claude', '~/.claude-work']);
    expect(state.config.claudeConfigDirs).toEqual(['~/.claude-work']);
  });

  it('stores an absolute path under HOME as a ~/ token', () => {
    const result = registerAgentConfigDir(`${homedir()}/.claude-work`);
    expect(result).toEqual(['~/.claude', '~/.claude-work']);
    expect(state.config.claudeConfigDirs).toEqual(['~/.claude-work']);
  });

  it('keeps a machine-local path outside HOME verbatim', () => {
    const result = registerAgentConfigDir('/opt/claude-work');
    expect(result).toEqual(['~/.claude', '/opt/claude-work']);
  });

  it('ignores a duplicate of an already-registered directory', () => {
    registerAgentConfigDir('~/.claude-work');
    const before = state.config.claudeConfigDirs;
    const result = registerAgentConfigDir('~/.claude-work');
    expect(result).toEqual(['~/.claude', '~/.claude-work']);
    // No write for a no-op registration.
    expect(state.config.claudeConfigDirs).toBe(before);
  });

  it('ignores a registration matching the default', () => {
    const result = registerAgentConfigDir('~/.claude');
    expect(result).toEqual(['~/.claude']);
    expect(state.config.claudeConfigDirs).toBeUndefined();
  });

  it('throws a clear error for input that is neither absolute nor under home', () => {
    expect(() => registerAgentConfigDir('relative/path')).toThrow(
      /Not an absolute path or a path under your home directory: "relative\/path"/
    );
  });

  it('removes a registered directory', () => {
    registerAgentConfigDir('~/.claude-work');
    const result = forgetAgentConfigDir('~/.claude-work');
    expect(result).toEqual(['~/.claude']);
    expect(state.config.claudeConfigDirs).toEqual([]);
  });

  it('matches a stored entry saved before normalization existed', () => {
    // Simulate an old, unnormalized entry: the absolute form of a
    // path under home, rather than the ~/ token it normalizes to.
    state.config = { claudeConfigDirs: [`${homedir()}/.claude-work`] };
    const result = forgetAgentConfigDir('~/.claude-work');
    expect(result).toEqual(['~/.claude']);
  });

  it('refuses to remove the default', () => {
    expect(() => forgetAgentConfigDir('~/.claude')).toThrow(
      /default Claude configuration directory cannot be removed/
    );
  });
});
