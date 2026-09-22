import {
  hasLiveTmuxSession,
  isSessionAlive,
  listOurSessionsWith,
  resolveWorktreeSession,
} from '@n10/core';
import { listMachines } from './machines.js';
import { machineFor } from './remote-machines.js';

/**
 * `checkoutPlanCore` (`@n10/core`'s `checkoutPlan`) and
 * `getSessionLaunchContext` (`session-launch-options.ts`) both resolve a
 * branch's session by *local* state only, so a branch whose agent runs
 * on another paired machine finds nothing there — the plan pane would
 * create a second local worktree and spawn a second agent for it, and
 * the main launch dialog would offer "Start new session" with the local
 * default and do the same, the duplicate-agent shape a whole review
 * round closed on the discovery launch path (`open-session.ts`'s
 * `findSession`). `refuseIfRemoteOwns` below is what `sessions.ts` calls
 * for both — first checking `hasLocalAgent` so a branch already running
 * right here is never refused just because a peer also has a session
 * tagged with the same repo path and branch (finding 1). Rather than
 * threading a machine through either surface, this refuses loudly and
 * names the machine: a known limitation, not a silent duplicate.
 *
 * Only machines with a live connection are asked — a
 * `reachable`/`unknown`/`unreachable` peer would need dialing first,
 * which this check is not the place to do — and a probe failure for
 * one machine must not block the others or the local path.
 */
export async function findRemoteBranchOwner(
  repoCwd: string,
  branch: string
): Promise<string | null> {
  let machines;
  try {
    machines = await listMachines();
  } catch {
    return null; // No beam node running — nothing to check against.
  }
  for (const machine of machines) {
    if (machine.isLocal || machine.state !== 'connected') continue;
    const label = await ownerLabelIfRunning(machine, repoCwd, branch);
    if (label) return label;
  }
  return null;
}

async function ownerLabelIfRunning(
  machine: { peerId: string; label: string },
  repoCwd: string,
  branch: string
): Promise<string | null> {
  try {
    const sessions = await listOurSessionsWith(
      machineFor(machine.peerId).executor,
      machine.peerId
    );
    const found = resolveWorktreeSession(repoCwd, branch, sessions);
    return found && !found.paneDead ? machine.label : null;
  } catch {
    return null; // Unreachable mid-check — do not block on it.
  }
}

/**
 * Whether `name` already has a live agent on *this* machine — the
 * registry (this host's own PTY) or, absent that, native tmux (a
 * session this host has not adopted yet, e.g. discovered or after a
 * restart). A live local agent always wins: neither the plan pane's
 * "send to agent" nor a plain launch may ask whether some other
 * machine also has a session for this branch when the one right here
 * is what the user means to use (finding 1).
 */
function hasLocalAgent(name: string): boolean {
  return isSessionAlive(name) || hasLiveTmuxSession(name);
}

/**
 * Refuse a *local* launch/send when `branch` already has a live agent
 * on a paired machine and nothing local claims it first — the
 * duplicate-agent shape closed on the discovery launch path
 * (`open-session.ts`'s `findSession`) and reopened on the plan pane
 * (finding 1) and the main launch dialog (finding 4). Both call sites
 * in `sessions.ts` share this one guard rather than each re-deriving
 * it, and both check {@link hasLocalAgent} first so a live local agent
 * is never refused because some other machine also happens to have a
 * session tagged with the same repo path and branch.
 */
export async function refuseIfRemoteOwns(
  repoCwd: string,
  branch: string,
  name: string
): Promise<void> {
  if (hasLocalAgent(name)) return;
  const remoteOwner = await findRemoteBranchOwner(repoCwd, branch);
  if (remoteOwner) {
    throw new Error(
      `An agent for ${branch} is already running on ${remoteOwner}. Open it there instead of starting a second one here.`
    );
  }
}
