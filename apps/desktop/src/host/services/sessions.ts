import { worktreeSessionKey, sessionLabel } from '@n10/core';
import {
  buildReviewLaunchRequest,
  checkoutPlan as checkoutPlanCore,
  launchSession,
  getSession,
  stopSession,
  sessionIdentity,
  isSessionAlive,
  hasSessionConnection,
  resolveAgent,
  getSpawnedAt,
  noteInput,
  noteResize,
  noteSeen,
  snapshot as activitySnapshot,
} from '@n10/core';
import { readConfig } from '@n10/vcs-core';
import { tmuxSessionSnapshot, sameTmuxIncarnation } from '@n10/terminal-tmux';
import { createWorktree } from '@n10/worktree-manager';
import { requireRepo } from './repo.js';
import {
  attachRelay,
  newRelayEntry,
  relayBuffer,
  setSessionBroadcaster,
  type RelayEntry,
} from './session-relay.js';
import { agentTerminalNames, terminalBuffer } from './terminals.js';
import type {
  PlanCheckoutRequest,
  PlanCheckoutResult,
  ReviewLaunchRequest,
  SessionBuffer,
  SessionLaunchRequest,
  SessionSummary,
} from '../contract.js';

export type { SessionLaunchRequest, SessionSummary };

/** What launching or reattaching an agent hands back to the caller. */
interface LaunchResult {
  name: string;
}

const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 40;

// The output relay (ring buffer + push to the renderer) lives in
// session-relay.ts, shared with terminal tabs; main.ts still installs
// the broadcaster through this module.
export { setSessionBroadcaster };

interface KnownSession extends RelayEntry {
  branch: string;
  /** Repository displayed by this relay. Qualified keys let other repos stay live. */
  repoCwd: string;
}

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
function adoptSession(name: string, branch: string, repoCwd: string): void {
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

/** The grid a session starts on when no pane has measured one yet. */
export function defaultPaneSize(): { cols: number; rows: number } {
  return { cols: DEFAULT_COLS, rows: DEFAULT_ROWS };
}

// ── Known sessions ───────────────────────────────────────────────
// The pty-registry has no iteration API (the CLI enumerates via its
// own React state), so the desktop host tracks the sessions it
// launched. Entries persist after exit so the final frame stays
// viewable — matching TUI behavior.

const known = new Map<string, KnownSession>();

/** The session under `name`, but only when it belongs to the repo
 *  that's open now. Entries for other repos stay in the map (their
 *  agents are still running and are restored on switching back) but are
 *  invisible to this repo's UI and operations. */
function ownSession(name: string): KnownSession | undefined {
  const entry = known.get(name);
  if (!entry) return undefined;
  return entry.repoCwd === requireRepo() ? entry : undefined;
}

/** Names this host launched for the currently open repo. */
function ownSessionNames(): string[] {
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

/** Shared by {@link killOwnSession} and {@link killSession}: stop `name`
 *  only when it is a worktree session this repository actually owns. */
function stopOwnWorktreeSession(name: string): void {
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
function foreignSessionError(name: string): Error {
  return new Error(
    `The session "${sessionLabel(name)}" belongs to another repository. ` +
      `Open that repository to manage it.`
  );
}

// ── Operations ───────────────────────────────────────────────────

// Overlapping launch calls for the same session (double-click racing
// the renderer's isPending flag) must not double-spawn: the second
// spawn would dispose the first PTY and attach a duplicate data relay.
const inflightLaunches = new Map<
  string,
  { signature: string; promise: Promise<{ name: string }> }
>();

/**
 * `knownWorktreePath` is for callers that have already been told where
 * the checkout is — discovery hands over the worktree git actually
 * reported. It is deliberately a parameter rather than a field on
 * `SessionLaunchRequest`: that type crosses the IPC bridge, and the
 * renderer has no business naming a directory to spawn an agent in.
 */
export function launchAgent(
  req: SessionLaunchRequest,
  knownWorktreePath?: string
): Promise<LaunchResult> {
  const repo = requireRepo();
  const name = worktreeSessionKey(req.branch, repo);
  const signature = JSON.stringify([
    req.intent,
    req.agentId,
    req.prompt,
    req.systemGuidance,
    req.fresh,
    req.expected,
    knownWorktreePath,
  ]);
  const existing = inflightLaunches.get(name);
  if (existing) {
    return existing.signature === signature
      ? existing.promise
      : Promise.reject(
          new Error(
            'Another launch is in progress for this worktree. Try again when it finishes.'
          )
        );
  }
  const promise = doLaunchAgent(req, name, knownWorktreePath).finally(() =>
    inflightLaunches.delete(name)
  );
  inflightLaunches.set(name, { signature, promise });
  return promise;
}

async function doLaunchAgent(
  req: SessionLaunchRequest,
  name: string,
  knownWorktreePath?: string
): Promise<{ name: string }> {
  const repoCwd = requireRepo();
  if (canReuseConnection(req, name)) {
    // A stale UI request must not read another repository's relay.
    if (!ownSession(name)) throw foreignSessionError(name);
    return { name };
  }
  // Use the actual checkout path reported by discovery, or resolve this exact branch.
  const wtPath =
    knownWorktreePath ?? (await createWorktree(req.branch, repoCwd));
  if (!wtPath) {
    throw new Error(`Failed to resolve a worktree for "${req.branch}"`);
  }
  // Config comes from the repo root, like the TUI — per-project config
  // is keyed by cwd hash, so reading from the worktree path resolved a
  // different (empty) project bag.
  // A per-launch agent pick from the session menu overrides the
  // configured one; the resolver still owns the id → agent mapping.
  const stored = readConfig(repoCwd);
  const config = req.agentId ? { ...stored, agentId: req.agentId } : stored;
  const before = getSession(name);
  const entry = await launchSession({
    name,
    cwd: wtPath,
    cols: clampDim(req.cols, DEFAULT_COLS),
    rows: clampDim(req.rows, DEFAULT_ROWS),
    config,
    agent: needsSelectedAgent(req) ? resolveAgent(config) : undefined,
    mode: knownWorktreePath ? 'attach' : 'open',
    fresh: req.fresh,
    expected: req.expected,
    request: {
      intent: req.intent,
      prompt: req.prompt,
      systemGuidance: req.systemGuidance,
    },
  });
  if (entry !== before || !ownSession(name))
    adoptSession(name, req.branch, repoCwd);
  return { name };
}

export {
  listAgentOptions,
  getSessionLaunchContext,
} from './session-launch-options.js';

/**
 * Start (or resume) an AI review of `req.pr` with the shared review
 * prompt. Same flow as the TUI's "Start/Continue review" menu entry —
 * launchAgent resolves or creates the worktree.
 */
export async function launchReviewAgent(req: ReviewLaunchRequest): Promise<{
  name: string;
}> {
  requireRepo();
  const branch = req.pr.sourceBranch;
  const request = buildReviewLaunchRequest(req.pr, req.instruction);
  return launchAgent({
    branch,
    intent: 'seed',
    fresh: true,
    expected: req.expected,
    agentId: req.agentId,
    prompt: request.prompt,
    systemGuidance: request.systemGuidance,
    cols: req.cols,
    rows: req.rows,
  });
}

// Double-sends land here the way double-clicks land on launch: the
// renderer disables the button while a send is in flight, but the
// second click can beat the state update. Joining the in-flight
// promise makes the second one a no-op instead of a second spawn.
// (A checkout racing a plain launch of the same branch is not
// serialized — the loser's PTY is disposed by the winner's spawn,
// which is the same outcome as two launches racing.)
const inflightCheckouts = new Map<string, Promise<PlanCheckoutResult>>();

/**
 * Send a composed plan to the agent for `req.pr`.
 *
 * The three-state decision — inject into a live agent, respawn it, or
 * create the worktree and start one — lives in @n10/core and is
 * shared with the TUI. What the desktop adds is its own bookkeeping:
 * the ownership guard, and adopting whatever PTY comes out so its
 * output reaches the renderer.
 */
export function checkoutPlan(
  req: PlanCheckoutRequest
): Promise<PlanCheckoutResult> {
  const repoCwd = requireRepo();
  const name = worktreeSessionKey(req.pr.sourceBranch, repoCwd);
  // Reject a stale request aimed at another repository's relay.
  if (known.has(name) && !ownSession(name)) throw foreignSessionError(name);
  const existing = inflightCheckouts.get(name);
  if (existing) return existing;
  const promise = doCheckoutPlan(req, name, repoCwd).finally(() =>
    inflightCheckouts.delete(name)
  );
  inflightCheckouts.set(name, promise);
  return promise;
}

async function doCheckoutPlan(
  req: PlanCheckoutRequest,
  name: string,
  repoCwd: string
): Promise<PlanCheckoutResult> {
  const config = readConfig(repoCwd);
  // core reports failures by flashing a status line, which the TUI has
  // and the host does not. Capture the message and reject with it: the
  // renderer toasts it and leaves the plan intact for a retry.
  let failure: string | null = null;
  const before = getSession(name);
  const result = await checkoutPlanCore({
    repo: repoCwd,
    pr: req.pr,
    prompt: req.prompt,
    paneCols: clampDim(req.cols, DEFAULT_COLS),
    paneRows: clampDim(req.rows, DEFAULT_ROWS),
    mode: req.mode,
    config,
    flashStatus: (msg) => {
      failure ??= msg;
    },
  });
  if (result === 'failed') {
    throw new Error(failure ?? 'Could not send the plan to the agent');
  }
  if (
    result === 'spawned' ||
    (getSession(name) && getSession(name) !== before)
  ) {
    adoptSession(name, req.pr.sourceBranch, repoCwd);
  }
  return result;
}

function clampDim(value: number | undefined, fallback: number): number {
  if (!value || !Number.isFinite(value) || value < 2) return fallback;
  return Math.min(500, Math.floor(value));
}

export function listSessions(): SessionSummary[] {
  return ownSessionNames().map((name) => ({
    name,
    running: isSessionAlive(name),
    spawnedAt: getSpawnedAt(name) ?? 0,
  }));
}

export function writeSession(name: string, data: string): void {
  const entry = getSession(name);
  if (!entry || entry.exited) throw new Error(`Session ${name} is not running`);
  if (entry.pty.connectionState && entry.pty.connectionState !== 'connected') {
    throw new Error(
      'The terminal is reconnecting. Try again when it reconnects.'
    );
  }
  // Same as the TUI's input forwarder: without this, the terminal
  // echoing keystrokes back would count as agent activity.
  noteInput(name);
  entry.pty.write(data);
}

export function resizeSession(name: string, cols: number, rows: number): void {
  const entry = getSession(name);
  if (!entry) return;
  // SIGWINCH redraws aren't agent activity either.
  noteResize(name);
  entry.pty.resize(cols, rows);
}

/** Debounced agent-activity snapshots for every session this host has
 *  launched — the same registry the TUI's sidebar spinner reads. A
 *  shell terminal is excluded: it animates on whatever the user types
 *  (`ls`, a build) with no agent behind it, and the working-agent
 *  spinner would read that as an agent busy at work. */
export function getSessionActivity(): Record<
  string,
  ReturnType<typeof activitySnapshot>
> {
  const out: Record<string, ReturnType<typeof activitySnapshot>> = {};
  for (const name of [...ownSessionNames(), ...agentTerminalNames()]) {
    out[name] = activitySnapshot(name);
  }
  return out;
}

export function markSessionSeen(name: string): void {
  noteSeen(name);
}

export function killSession(name: string): void {
  // Never reach into another repository's agent (see KnownSession.repoCwd).
  // Qualified identity also protects entries this host did not launch.
  if (known.has(name) && !ownSession(name)) throw foreignSessionError(name);
  stopOwnWorktreeSession(name);
}

// `name` is only a tmux label — tmux-launch.ts's create path reuses one
// once its holder is killed — so a matching `expected` is verified
// against a fresh snapshot's native incarnation, not the cached
// `pty.name`, which cannot tell a live reuse from a same-named
// replacement underneath it. A mismatch or unreadable snapshot falls
// through to the full launch path's own guarded compare-and-swap.
function canReuseConnection(req: SessionLaunchRequest, name: string): boolean {
  if (req.fresh || !isSessionAlive(name) || !hasSessionConnection(name))
    return false;
  if (!req.expected) return true;
  const nativeName = getSession(name)?.pty.name;
  const live = nativeName && tmuxSessionSnapshot(nativeName)?.incarnation;
  return !!live && sameTmuxIncarnation(live, req.expected);
}

function needsSelectedAgent(req: SessionLaunchRequest): boolean {
  return Boolean(req.fresh || req.agentId || req.intent === 'blank');
}

export function getSessionBuffer(name: string): SessionBuffer {
  const entry = ownSession(name);
  if (entry) return relayBuffer(entry);
  // A terminal tab belongs to a directory, not to the open repository,
  // so its scrollback is answered whatever repository that is.
  return terminalBuffer(name) ?? { data: '', seq: 0 };
}
