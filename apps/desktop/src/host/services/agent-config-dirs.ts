import {
  configDirOptions,
  DEFAULT_CONFIG_DIR,
  normalizeConfigDir,
  type ConfigDirToken,
} from '@n10/core';
import { readGlobalConfig, writeGlobalConfig } from '@n10/vcs-core';

/**
 * Registered Claude configuration directories, machine-global rather
 * than per-repository — see `@n10/core`'s `agent-config-dirs.ts` for
 * why a directory is a token, never an expanded path. Deliberately not
 * gated on `requireRepo()`: which directories exist on this machine
 * has nothing to do with which repository happens to be open.
 */

/** Every directory a launch may pick between, default first. */
export function listAgentConfigDirs(): ConfigDirToken[] {
  return configDirOptions(readGlobalConfig().claudeConfigDirs);
}

/**
 * Register a new directory, typed as an absolute path or one under
 * home. Already-known tokens (the default included) are left alone —
 * registering the same directory twice is not an error, just a no-op.
 */
export function registerAgentConfigDir(input: string): ConfigDirToken[] {
  const token = normalizeConfigDir(input);
  if (!token) {
    throw new Error(
      `Not an absolute path or a path under your home directory: "${input}"`
    );
  }
  const config = readGlobalConfig();
  const existing = configDirOptions(config.claudeConfigDirs);
  if (existing.includes(token)) return existing;
  const stored = [...(config.claudeConfigDirs ?? []), token];
  writeGlobalConfig({ ...config, claudeConfigDirs: stored });
  return configDirOptions(stored);
}

/**
 * Remove a registered directory. The default is always available and
 * cannot be forgotten. Stored entries are normalized before comparing,
 * so a token saved before normalization existed (or typed some other
 * equivalent way) still matches.
 */
export function forgetAgentConfigDir(token: string): ConfigDirToken[] {
  const target = normalizeConfigDir(token) ?? token;
  if (target === DEFAULT_CONFIG_DIR) {
    throw new Error(
      'The default Claude configuration directory cannot be removed.'
    );
  }
  const config = readGlobalConfig();
  const stored = (config.claudeConfigDirs ?? []).filter(
    (entry) => normalizeConfigDir(entry) !== target
  );
  writeGlobalConfig({ ...config, claudeConfigDirs: stored });
  return configDirOptions(stored);
}
