import { readGlobalConfig } from '@n10/vcs-core';
import {
  configDirEnv,
  type ConfigDirToken,
} from '../agents/agent-config-dirs.js';

// ── The machine's half of a session's environment ────────────────
//
// `open-session` builds a session's environment from `process.env`
// plus an `additions` map. The two halves are not interchangeable:
// `process.env` describes the *orchestrating* process, while
// `additions` describes the launch, and a launch may one day happen on
// a machine that is not this one. So everything in `additions` has to
// be true of the machine the agent will run on.
//
// That is why nothing here accepts a path from its caller. A caller
// asks for a *capability* — "use the work Claude configuration" — and
// this module answers it against the machine it is running on, at the
// moment of launch. A machine-aware launcher runs the same resolution
// on the target host and gets that host's answer, rather than being
// handed this host's and having to undo it.

/** What a launch wants from the machine it lands on. */
export interface MachineEnvRequest {
  /**
   * Which registered Claude configuration directory to use, as a
   * token (`~/.claude-work`) — never an expanded path. Unset leaves
   * `CLAUDE_CONFIG_DIR` alone, so the host decides.
   *
   * **Local launches only** — see {@link machineEnvAdditions}.
   */
  configDir?: ConfigDirToken;
  /**
   * Whether the session will run on this machine. Defaults to true,
   * which is every launch there is today.
   */
  local?: boolean;
}

/** Config directories only mean anything to the agent that reads them. */
const CONFIG_DIR_AGENTS = new Set(['claude']);

/**
 * The additions this machine contributes to a launch.
 *
 * `agent` is the resolved agent id.
 *
 * **The Claude configuration directory is deliberately local-only.**
 * A remote machine has its own home directory, its own credentials and
 * its own registered directories, and it is not this machine's business
 * to choose between them: a remote launch is sent no
 * `CLAUDE_CONFIG_DIR` at all and uses whatever that host defaults to.
 * That is the intended behaviour and not a gap to be filled — forwarding
 * this host's answer is the bug, which is why it is gated here rather
 * than left to a caller to remember. `sessionEnvFlags` in
 * `libs/terminal-tmux/src/lib/tmux-launch.ts` reasons the same way
 * about PATH and HOME.
 */
export function machineEnvAdditions(
  request: MachineEnvRequest | undefined,
  agent: string | undefined
): Record<string, string> {
  if (!request) return {};
  const localAgentConfig =
    request.local !== false && agent && CONFIG_DIR_AGENTS.has(agent);
  return {
    ...(localAgentConfig
      ? configDirEnv(request.configDir, readGlobalConfig().claudeConfigDirs)
      : {}),
  };
}
