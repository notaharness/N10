import { homedir } from 'node:os';
import { isAbsolute, normalize } from 'node:path';

// ── Claude config directories ────────────────────────────────────
//
// Where Claude keeps its own configuration — credentials, settings,
// project history — is a property of the *machine the agent runs on*,
// not of the agent and not of the launch. A second machine has its own
// home directory and its own copy of whatever the user keeps there.
//
// So a registered directory is stored, carried and compared as a
// **token**, never as an expanded path: `~/.claude-work` names "the
// work configuration on whichever machine is running this", and is
// resolved against that machine's HOME at the moment of launch. That is
// the same reasoning `sessionEnvFlags` applies to PATH and HOME in
// `libs/terminal-tmux/src/lib/tmux-launch.ts`, and the reason nothing
// here ever puts an absolute local path into a launch request.
//
// A directory that is not under HOME cannot be expressed that way. It
// is kept absolute and is **machine-local**: it describes one
// filesystem and must not be forwarded to another machine. Callers that
// can launch somewhere else ask {@link isMachineLocalConfigDir} and
// leave the variable unset instead — which is the whole point of
// keeping "unset" meaningful: it means *let that host decide*.

/** The environment variable Claude reads its configuration directory from. */
export const CLAUDE_CONFIG_DIR_ENV = 'CLAUDE_CONFIG_DIR';

/** The entry every machine has, and the fallback when none is registered. */
export const DEFAULT_CONFIG_DIR = '~/.claude';

const HOME_PREFIX = '~/';

/**
 * A token as it is stored and displayed.
 *
 * Portable tokens start with `~/`. Anything else is an absolute path
 * on one machine — see {@link isMachineLocalConfigDir}.
 */
export type ConfigDirToken = string;

/** Whether `token` names a location on one specific machine. */
export function isMachineLocalConfigDir(token: ConfigDirToken): boolean {
  return !token.startsWith(HOME_PREFIX);
}

/**
 * Turn what a user typed into a storable token.
 *
 * A path under HOME — typed as `~/.claude-work` or as the absolute
 * `/home/me/.claude-work`, which is the same directory said two ways —
 * is stored HOME-relative, so it keeps meaning something on a machine
 * whose home is somewhere else. A path outside HOME is kept verbatim
 * and stays machine-local. Returns `null` for input that is neither:
 * a bare relative path has no anchor to resolve against.
 */
export function normalizeConfigDir(
  input: string,
  home: string = homedir()
): ConfigDirToken | null {
  const trimmed = input.trim().replace(/\/+$/, '');
  if (!trimmed) return null;
  if (trimmed === '~') return null;
  if (trimmed.startsWith(HOME_PREFIX)) {
    const rest = normalize(trimmed.slice(HOME_PREFIX.length));
    return rest.startsWith('..') ? null : `${HOME_PREFIX}${rest}`;
  }
  if (!isAbsolute(trimmed)) return null;
  const full = normalize(trimmed);
  if (full === home) return null;
  return full.startsWith(`${home}/`)
    ? `${HOME_PREFIX}${full.slice(home.length + 1)}`
    : full;
}

/**
 * The directories a launch may choose between on this machine: the
 * default first, then everything registered, deduplicated and with
 * unusable entries dropped.
 *
 * The default is always present and always first — it is what a launch
 * gets without touching the control, and what a machine with nothing
 * registered has.
 */
export function configDirOptions(
  stored: readonly string[] | undefined,
  home: string = homedir()
): ConfigDirToken[] {
  const seen = new Set<ConfigDirToken>([DEFAULT_CONFIG_DIR]);
  const options: ConfigDirToken[] = [DEFAULT_CONFIG_DIR];
  for (const entry of stored ?? []) {
    const token = normalizeConfigDir(entry, home);
    if (!token || seen.has(token)) continue;
    seen.add(token);
    options.push(token);
  }
  return options;
}

/**
 * Expand a token against this machine's home directory.
 *
 * The one place a token becomes a path, and it happens on the machine
 * that is about to run the agent.
 */
export function expandConfigDir(
  token: ConfigDirToken,
  home: string = homedir()
): string {
  return token.startsWith(HOME_PREFIX)
    ? `${home}/${token.slice(HOME_PREFIX.length)}`
    : token;
}

/**
 * The `CLAUDE_CONFIG_DIR` a launch on this machine gets for `token`.
 *
 * `undefined` — nothing was selected, because the launch is an attach,
 * a restart that recorded no choice, or a shell with no such control —
 * yields no variable at all, leaving whatever the host already has in
 * force. A token that is not registered here yields nothing for the
 * same reason: a machine answers for its own directories, and inventing
 * a path for a name it does not know is worse than deferring.
 */
export function configDirEnv(
  token: ConfigDirToken | undefined,
  stored: readonly string[] | undefined,
  home: string = homedir()
): Record<string, string> {
  if (!token) return {};
  const options = configDirOptions(stored, home);
  if (!options.includes(token)) return {};
  return { [CLAUDE_CONFIG_DIR_ENV]: expandConfigDir(token, home) };
}
