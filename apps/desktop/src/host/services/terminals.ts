import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute } from 'node:path';
import {
  getSession,
  detachSession,
  getSpawnedAt,
  isSessionAlive,
  hasPersistedTerminalSession,
  killSession as killSessionEntry,
  launchTerminalSession,
  releaseExitedSession,
  sessionIdentity,
  type DiscoveredTerminal,
} from '@n10/core';
import { readConfig } from '@n10/vcs-core';
import type {
  SessionBuffer,
  TerminalKind,
  TerminalLaunchRequest,
  TerminalSummary,
} from '../contract.js';
import { ensureRecent } from './recent-repos.js';
import { isGitRepo } from './repo.js';
import {
  attachRelay,
  broadcastLaunchStep,
  newRelayEntry,
  relayBuffer,
  type RelayEntry,
} from './session-relay.js';
import { displayPath, terminalRepo } from './terminal-home.js';

/**
 * Terminal tabs, host side.
 *
 * A terminal is a session bound to a directory: a shell or an agent,
 * opened wherever the user asked for it. Unlike a worktree session it
 * belongs to no repository *by construction* — which repository it is
 * shown under is derived from its directory every time it is listed,
 * and a terminal in another checkout, or in no checkout at all, is
 * still this user's terminal whatever repository is open. So nothing
 * here goes through `requireRepo`.
 *
 * There is no state file. The session's `@orchestra-session-type` tag
 * carries the kind, its name is its key, tmux carries the directory
 * (`session_path`), and discovery hands all of it back after a restart
 * through {@link adoptTerminal}.
 */

const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 40;

interface KnownTerminal extends RelayEntry {
  kind: TerminalKind;
  cwd: string;
}

const known = new Map<string, KnownTerminal>();

/**
 * Reject a directory a terminal cannot actually launch into, before it
 * reaches tmux. Without this an invalid `cwd` (a relative
 * path — the chooser only ever hands over absolute ones, but the host
 * is the boundary that must not trust that — or one that does not
 * exist) surfaces as an opaque `posix_spawnp failed` from node-pty or a
 * tmux client that exits the instant it starts, neither of which names
 * the actual problem.
 */
function assertLaunchableCwd(cwd: string): void {
  if (!isAbsolute(cwd)) {
    throw new Error(`Terminal directory must be an absolute path: ${cwd}`);
  }
  let isDir: boolean;
  try {
    isDir = statSync(cwd).isDirectory();
  } catch {
    isDir = false;
  }
  if (!isDir) {
    throw new Error(`Terminal directory does not exist: ${cwd}`);
  }
}

function clampDim(value: number | undefined, fallback: number): number {
  if (!value || !Number.isFinite(value) || value < 2) return fallback;
  return Math.min(500, Math.floor(value));
}

interface TerminalSize {
  cols?: number;
  rows?: number;
  fresh?: boolean;
  machine?: string;
  /** Set only alongside `machine`: correlates `onLaunchStep` events. */
  launchId?: string;
}
const starting = new Map<
  string,
  { signature: string; promise: Promise<string> }
>();

/** Only the fields that change what gets launched — coalescing must
 *  never join a concurrent request with a different outcome (a Resume
 *  then a Start-new within one launch window, say). */
function startSignature(
  kind: TerminalKind,
  cwd: string,
  size: TerminalSize,
  mode?: 'open' | 'attach'
): string {
  return JSON.stringify([kind, cwd, size.fresh, mode, size.machine]);
}

function start(
  requestedName: string | undefined,
  kind: TerminalKind,
  cwd: string,
  size: TerminalSize,
  mode?: 'open' | 'attach'
): Promise<string> {
  if (!requestedName) return performStart(requestedName, kind, cwd, size, mode);
  const signature = startSignature(kind, cwd, size, mode);
  const pending = starting.get(requestedName);
  if (pending) {
    if (pending.signature !== signature)
      return Promise.reject(
        new Error(
          'Another launch is in progress for this terminal. Try again when it finishes.'
        )
      );
    return pending.promise;
  }
  const promise = performStart(requestedName, kind, cwd, size, mode).finally(
    () => starting.delete(requestedName)
  );
  starting.set(requestedName, { signature, promise });
  return promise;
}

async function performStart(
  requestedName: string | undefined,
  kind: TerminalKind,
  cwd: string,
  size: TerminalSize,
  mode?: 'open' | 'attach'
): Promise<string> {
  // A terminal has no worktree step — only a remote fresh launch (never
  // a restart, which ignores `machine`) gets a step at all, and it is
  // the one step a plain terminal ever has.
  if (!requestedName && size.machine && size.launchId) {
    broadcastLaunchStep({ launchId: size.launchId, step: 'start' });
  }
  // Config for the directory, not for whatever repository is open: an
  // agent at a repository root should be that repository's agent.
  const launched = await launchTerminalSession({
    name: requestedName,
    kind,
    cwd,
    cols: clampDim(size.cols, DEFAULT_COLS),
    rows: clampDim(size.rows, DEFAULT_ROWS),
    config: readConfig(cwd),
    mode,
    fresh: size.fresh,
    // A restart (requestedName set) ignores this: the retained
    // terminal's own machine (carried in its key) wins.
    machine: requestedName ? undefined : size.machine,
  });
  const name = launched.name;
  const prev = requestedName ? known.get(requestedName) : undefined;
  if (requestedName && name !== requestedName) known.delete(requestedName);
  const entry: KnownTerminal = {
    ...newRelayEntry(prev?.seq ?? 0),
    kind,
    cwd,
  };
  known.set(name, entry);
  watchForEnd(name, entry);
  attachRelay(name, entry);
  return name;
}

/** Exited agents retain their pane and tab; shells close when their process ends. */
function watchForEnd(name: string, entry: KnownTerminal): void {
  const session = getSession(name);
  if (!session) throw new Error(`Terminal ${name} vanished after launch`);
  session.pty.onExit(() => {
    if (getSession(name) !== session || known.get(name) !== entry) return;
    if (entry.kind === 'agent' && hasPersistedTerminalSession(name)) return;
    known.delete(name);
    releaseExitedSession(name);
  });
}

/** A repository root the user reached through a terminal goes on the
 *  repo list, so the tab's repository can be opened like any other. */
function noteRepository(cwd: string): string | null {
  const repo = terminalRepo(cwd, isGitRepo);
  if (repo) ensureRecent(repo);
  return repo;
}

function summarize(name: string, entry: KnownTerminal, home: string) {
  const session = getSession(name);
  const machine = sessionIdentity(name)?.machine ?? 'local';
  return {
    name,
    ...(session?.pty.name ? { tmuxName: session.pty.name } : {}),
    kind: entry.kind,
    agent: session?.agent,
    cwd: entry.cwd,
    displayPath: displayPath(entry.cwd, home),
    // `terminalRepo`/`isGitRepo` stat the local filesystem: meaningless
    // for a directory that lives on another machine.
    repo: machine === 'local' ? terminalRepo(entry.cwd, isGitRepo) : null,
    running: isSessionAlive(name),
    spawnedAt: getSpawnedAt(name) ?? 0,
    machine,
    ...(session?.pty.connectionState
      ? { connectionState: session.pty.connectionState }
      : {}),
  };
}

/** Open a new terminal. `home` is injectable for tests. */
export async function launchTerminal(
  req: TerminalLaunchRequest,
  home: string = homedir()
): Promise<TerminalSummary> {
  const existing = req.sessionName ? known.get(req.sessionName) : undefined;
  if (req.sessionName && !existing) throw new Error('Unknown terminal session');
  // A retained-tab restart launches in the tab's own directory, not
  // whatever cwd the request happened to carry.
  const cwd = existing?.cwd ?? req.cwd;
  // A remote machine's filesystem is not this one's to `statSync` —
  // the remote tmux/session-create call is what validates the
  // directory there, loudly, if it is wrong.
  if (!req.machine) assertLaunchableCwd(cwd);
  const name = await start(
    req.sessionName,
    existing?.kind ?? req.kind,
    cwd,
    req
  );
  // `terminalRepo`/`isGitRepo` stat the local filesystem: correct for
  // this machine's terminals, meaningless for `cwd` on another one.
  if (!req.machine) noteRepository(cwd);
  const entry = known.get(name);
  if (!entry) throw new Error(`Terminal ${name} ended during launch`);
  return summarize(name, entry, home);
}

/** Reattach to a terminal discovery found in tmux — the restore path,
 *  and the mid-run one. The name and directory are tmux's. */
export async function adoptTerminal(
  terminal: DiscoveredTerminal
): Promise<void> {
  await start(terminal.name, terminal.kind, terminal.path, {}, 'attach');
  noteRepository(terminal.path);
}

export function listTerminals(home: string = homedir()): TerminalSummary[] {
  return [...known.entries()].map(([name, entry]) =>
    summarize(name, entry, home)
  );
}

/** Kill the tmux session
 *  and forget the terminal. A name never launched here is nothing. */
export function killTerminal(name: string): void {
  if (!known.has(name)) return;
  killSessionEntry(name);
  known.delete(name);
}

/** Forget a target removed outside n10, without touching a replacement session. */
export function forgetTerminal(name: string): void {
  if (hasPersistedTerminalSession(name) || !known.delete(name)) return;
  detachSession(name);
}

export function isTerminal(name: string): boolean {
  return known.has(name);
}

export function terminalNames(): string[] {
  return [...known.keys()];
}

/** Terminal names of the `agent` kind only — a shell running whatever
 *  the user types (`ls`, a build) is not agent activity, and must not
 *  animate its tab with the working-agent spinner the way a real agent
 *  does. */
export function agentTerminalNames(): string[] {
  return [...known.entries()]
    .filter(([, entry]) => entry.kind === 'agent')
    .map(([name]) => name);
}

export function terminalBuffer(name: string): SessionBuffer | undefined {
  const entry = known.get(name);
  return entry ? relayBuffer(entry) : undefined;
}
