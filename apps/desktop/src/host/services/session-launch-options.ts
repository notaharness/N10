import {
  buildAgentOptions,
  getSessionLaunchContext as readSessionLaunchContext,
  resolveAgent,
  sessionKeyForBranch,
} from '@n10/core';
import { readConfig } from '@n10/vcs-core';
import type { AgentOptionView, SessionLaunchView } from '../contract.js';
import { requireRepo } from './repo.js';

/**
 * The session menu's agent picker: the configured agent first (the
 * launch you get without touching the picker), then the rest of the
 * registry. Same list, same order, same labels as the TUI.
 */
export function listAgentOptions(): AgentOptionView[] {
  const config = readConfig(requireRepo());
  return buildAgentOptions(config).map((o) => ({
    id: o.agent.id,
    name: o.name,
  }));
}

/** Read native state when the menu opens; no registry-only resume
 *  guesses. The session is the one in the checkout that has `branch`;
 *  with no such checkout there is none. */
export async function getSessionLaunchContext(
  branch: string
): Promise<SessionLaunchView> {
  const cwd = requireRepo();
  const config = readConfig(cwd);
  const name = await sessionKeyForBranch(branch, cwd);
  return {
    ...(name
      ? readSessionLaunchContext(name, config)
      : { exists: false, running: false, canResume: false }),
    defaultAgentName: resolveAgent(config).name,
  };
}
