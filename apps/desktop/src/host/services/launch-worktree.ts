import {
  resolveRemoteWorktreePath,
  sessionKeyForBranch,
  worktreeSessionKey,
} from '@n10/core';
import { createWorktree } from '@n10/worktree-manager';
import type { SessionLaunchRequest } from '../contract.js';
import { refuseIfRemoteOwns } from './plan-remote-owner.js';
import { machineFor } from './remote-machines.js';
import { broadcastLaunchStep } from './session-relay.js';

/**
 * The steps of a worktree agent launch before anything starts: the
 * fleet guard, and finding the checkout the session will belong to —
 * its key is that checkout, so nothing can be keyed before it is known.
 */

/** Named launch progress (ux-machines.md §5) — a no-op unless `req`
 *  names both a machine and a launchId, which only a remote launch's
 *  request ever does. */
export function noteLaunchStep(
  req: SessionLaunchRequest,
  step: 'worktree' | 'start'
): void {
  if (req.machine && req.launchId) {
    broadcastLaunchStep({ launchId: req.launchId, step });
  }
}

/** Refuse a local launch a fleet member already owns — before any
 *  local worktree is created for it. An explicit machine is the user's
 *  own choice of where to launch — `findSession` already resolves or
 *  creates on exactly that machine; only a local launch risks a second,
 *  local agent (finding 4). */
export async function refuseRemoteOwned(
  req: SessionLaunchRequest,
  repoCwd: string,
  knownWorktreePath?: string
): Promise<void> {
  if (req.machine) return;
  const local = knownWorktreePath
    ? worktreeSessionKey(knownWorktreePath, repoCwd)
    : await sessionKeyForBranch(req.branch, repoCwd);
  await refuseIfRemoteOwns(repoCwd, req.branch, local);
}

/** The checkout a launch runs in: the one discovery reported, or this
 *  exact branch's, created when there is none — on the right machine or
 *  not at all (`machineFor` throws for one it cannot build). Another
 *  machine's checkout is resolved to its physical path there, the form
 *  its session is keyed and tagged by. */
export async function resolveLaunchWorktree(
  req: SessionLaunchRequest,
  repoCwd: string,
  knownWorktreePath?: string
): Promise<string> {
  if (knownWorktreePath) return knownWorktreePath;
  const machine = req.machine ? machineFor(req.machine) : undefined;
  noteLaunchStep(req, 'worktree');
  const wtPath = await createWorktree(req.branch, repoCwd, machine);
  if (!wtPath) {
    throw new Error(`Failed to resolve a worktree for "${req.branch}"`);
  }
  return machine ? resolveRemoteWorktreePath(wtPath, machine.executor) : wtPath;
}
