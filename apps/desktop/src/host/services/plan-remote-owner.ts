import { listOurSessionsWith, resolveWorktreeSession } from '@n10/core';
import { listMachines } from './machines.js';
import { machineFor } from './remote-machines.js';

/**
 * `checkoutPlanCore` (`@n10/core`'s `checkoutPlan`, called from
 * `sessions.ts`) resolves a branch's session by *local* state only
 * (`isSessionAlive`/`hasLiveTmuxSession`), so a branch whose agent runs
 * on another paired machine finds nothing there, creates a second
 * local worktree and spawns a second agent for it — the duplicate-agent
 * shape a whole review round closed on the launch path
 * (`open-session.ts`'s `findSession`), left open on the plan pane's
 * "send to agent" path. Rather than threading a machine through the
 * plan pane (which has no machine selector at all today), this refuses
 * loudly and names the machine: a known limitation, not a silent
 * duplicate.
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
