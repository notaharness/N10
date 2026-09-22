import {
  sessionIdentity,
  sessionLabel,
  stopSession,
  isSessionAlive,
} from '@n10/core';
import { requireRepo } from './repo.js';
import {
  attachRelay,
  newRelayEntry,
  type RelayEntry,
} from './session-relay.js';

/**
 * Which sessions this host has launched, and the single-repository
 * ownership guard every launch and stop path shares. Split out of
 * `sessions.ts` to keep that file focused on the launch sequence
 * itself; this half is pure bookkeeping over one shared map.
 *
 * The pty-registry has no iteration API (the CLI enumerates via its
 * own React state), so the desktop host tracks the sessions it
 * launched. Entries persist after exit so the final frame stays
 * viewable — matching TUI behavior.
 */
export interface KnownSession extends RelayEntry {
  branch: string;
  /** Repository displayed by this relay. Qualified keys let other repos stay live. */
  repoCwd: string;
}

export const known = new Map<string, KnownSession>();

/**
 * Record a freshly spawned PTY and start relaying its output.
 *
 * `seq` is deliberately carried over when the name is respawned. A
 * mounted terminal remembers the sequence number its replayed snapshot
 * ended at and ignores anything at or below it, so restarting a session
 * behind a pane that is still on screen — relaunching a finished agent,
 * or restarting one with a plan — would emit chunks numbered from 1
 * again and the pane would drop every one of them. The scrollback
 * *is* reset: the new agent starts with an empty screen.
 */
export function adoptSession(
  name: string,
  branch: string,
  repoCwd: string
): void {
  const prev = known.get(name);
  const entry: KnownSession =
    prev && prev.repoCwd === repoCwd
      ? Object.assign(prev, { branch, chunks: [], bytes: 0 })
      : { ...newRelayEntry(), branch, repoCwd };
  known.set(name, entry);
  attachRelay(name, entry);
}

/**
 * Adopt a session another service had `@n10/core` spawn — the
 * babysitter's, started to receive an update when no agent was
 * running. Same bookkeeping as a launch from the renderer.
 */
export function adoptSpawnedSession(name: string, branch: string): void {
  adoptSession(name, branch, requireRepo());
}

/** The session under `name`, but only when it belongs to the repo
 *  that's open now. Entries for other repos stay in the map (their
 *  agents are still running and are restored on switching back) but are
 *  invisible to this repo's UI and operations. */
export function ownSession(name: string): KnownSession | undefined {
  const entry = known.get(name);
  if (!entry) return undefined;
  return entry.repoCwd === requireRepo() ? entry : undefined;
}

/** Names this host launched for the currently open repo. */
export function ownSessionNames(): string[] {
  const cwd = requireRepo();
  return [...known.entries()]
    .filter(([, e]) => e.repoCwd === cwd)
    .map(([name]) => name);
}

/** Whether this host holds a live session for the open repository. */
export function isOwnSessionAlive(name: string): boolean {
  return isSessionAlive(name) && ownSession(name) !== undefined;
}

/**
 * Stop `name`, unless it belongs to another repository — in which case
 * this repo has no agent under that name to stop (the guard in
 * `doLaunchAgent` makes a second one impossible), and killing it would
 * reach into the other repo's.
 *
 * Distinct from `killSession`, which throws: that one answers a user
 * pointing at a specific agent, where silence would be a lie. This one
 * is housekeeping inside a larger operation that is legitimate either
 * way, so it skips rather than aborting it.
 */
export function killOwnSession(name: string): void {
  if (known.has(name) && !ownSession(name)) return;
  stopOwnWorktreeSession(name);
}

/** Shared by {@link killOwnSession} and `sessions.ts`'s `killSession`:
 *  stop `name` only when it is a worktree session this repository
 *  actually owns. */
export function stopOwnWorktreeSession(name: string): void {
  const identity = sessionIdentity(name);
  if (identity?.kind === 'worktree' && identity.repo === requireRepo()) {
    stopSession(name);
  }
}

/** Whether a session under `name` is another repository's — known to
 *  this host, and not the open repository's. The babysitter asks
 *  before typing into one; the launch paths throw on the same test. */
export function isForeignSession(name: string): boolean {
  return known.has(name) && !ownSession(name);
}

/** Thrown when a session name is live but owned by another repository —
 *  acting on it would reach into that repo's agent. */
export function foreignSessionError(name: string): Error {
  return new Error(
    `The session "${sessionLabel(name)}" belongs to another repository. ` +
      `Open that repository to manage it.`
  );
}
