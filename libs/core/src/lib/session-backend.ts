/** tmux availability and discovery policy shared by both applications. */
import {
  canonicalWorktreePath,
  terminalSessionKey,
  sessionIdentity,
} from './session-key.js';
import { getRepoRoot } from './repo-root.js';
import {
  isTmuxAvailable,
  tmuxKillSession,
  type TmuxStatus,
} from '@n10/terminal-tmux';
import type {
  DiscoveredTerminal,
  DiscoveredWorktree,
} from './discovery/discovery-model.js';
import { liveSessionNames } from './pty-registry.js';
import {
  isTerminalSession,
  registryNameOf,
  type TaggedSession,
} from './session-identity.js';
import {
  listOurSessions,
  resolveRegistrySession,
  resolveSessionByName,
} from './session-resolver.js';

export { getRepoRoot, resetRepoRoot } from './repo-root.js';

// ── Tmux availability cache ─────────────────────────────────────
//
// The Settings UI guard runs synchronously inside an Ink input
// handler, so it can't await a Promise. We probe tmux once at
// startup and stash the result here for the handler to read.

let cachedTmuxStatus: TmuxStatus | null = null;

/** Run the tmux availability probe and cache the result. Call once
 *  at startup. Subsequent calls re-await the same memoized
 *  Promise from `@n10/terminal-tmux`'s `isTmuxAvailable()`. */
export async function probeTmuxAvailability(): Promise<void> {
  cachedTmuxStatus = await isTmuxAvailable();
}

/** Synchronously read the cached tmux status. Returns `null` if the
 *  probe hasn't completed yet (extremely unlikely after the first
 *  render — startup awaits it). */
export function getTmuxAvailability(): TmuxStatus | null {
  return cachedTmuxStatus;
}

/** Startup requires tmux; an old backend preference never selects a fallback. */
export function applySessionBackend(): void {
  if (!cachedTmuxStatus?.available) {
    throw new Error(
      `n10 requires tmux 3.2 or newer. ${
        cachedTmuxStatus?.reason ?? 'Availability has not been checked.'
      } ${cachedTmuxStatus?.installHint ?? 'Install tmux and restart n10.'}`
    );
  }
}

/** What one `tmux list-sessions` fork says about the sessions n10
 *  cares about. */
export interface TmuxObservation {
  /** The registry names of the asked-about worktrees that have a live
   *  tmux session tagged with this repository and their checkout. */
  persisted: Set<string>;
  /** Every terminal-tab session on the server, whatever directory or
   *  repository it belongs to, plus this repository's orphaned worktree
   *  sessions — see {@link observeTmuxSessions}. */
  terminals: DiscoveredTerminal[];
}

const NOTHING: TmuxObservation = { persisted: new Set(), terminals: [] };

/**
 * One fork, two answers: which worktree sessions survived, and which
 * terminal sessions exist.
 *
 * Every session is read through the resolver, so only tagged sessions
 * are seen at all: a session whose name n10 might have chosen but
 * that carries no tags is foreign and never listed. A worktree session
 * is this repository's when its `@orchestra-repo` is the open root;
 * it is *persisted* when one of the worktrees handed in is the
 * checkout it belongs to (`TaggedSession.worktreePath`), whichever
 * branch that checkout is on now. Another checkout's sessions carry
 * that checkout's root and are left alone.
 *
 * Terminal sessions are found by session type and reported wherever
 * they run, because a terminal belongs to its directory, not to the
 * repository this scan happens to be for — one opened in another
 * checkout still has to come back as a tab. Its directory is tmux's
 * own `session_path`; nothing is written to disk to remember it.
 *
 * A worktree session tagged with this repository whose checkout no
 * worktree answers to — its directory was removed, or its tag names a
 * path git no longer lists — is an orphan, and is reported as an agent
 * terminal in its directory, so it surfaces as a tab instead of running
 * on invisibly. It is never matched to a worktree by its branch: that
 * branch may be checked out in another worktree now, which would hand
 * that worktree this session's agent. Only when nothing here already
 * holds it, though, since attaching a second client to a session this
 * process is driving is exactly what the orphan path must not do.
 * Never throws; an absent tmux server yields nothing, same as no
 * sessions.
 */
export function observeTmuxSessions(
  worktrees: readonly DiscoveredWorktree[]
): TmuxObservation {
  const root = getRepoRoot();
  if (!root) return NOTHING;
  const ctx: ClassifyContext = {
    root,
    byPath: new Map(
      worktrees.map((wt) => [canonicalWorktreePath(wt.path), wt.name])
    ),
    owned: new Set(liveSessionNames()),
  };
  const persisted = new Set<string>();
  const terminals: DiscoveredTerminal[] = [];
  for (const session of listOurSessions()) {
    const found = classifySession(session, ctx);
    if (!found) continue;
    if (found.kind === 'terminal') terminals.push(found.terminal);
    else persisted.add(found.name);
  }
  return { persisted, terminals };
}

interface ClassifyContext {
  /** The open repository's root — what `@orchestra-repo` must equal. */
  root: string;
  /** Canonical checkout path → the registry name of that worktree. */
  byPath: Map<string, string>;
  /** Registry keys of every session this process already holds — see
   *  {@link liveSessionNames}. */
  owned: Set<string>;
}

/** What one of our live tmux sessions means to this repository: a
 *  worktree session that survived (`persisted`), a terminal tab to
 *  report (`terminal`), or nothing (`null`) — another repository's
 *  session, or one already owned that would otherwise read as an
 *  orphan. A terminal tab needs somewhere to run and display, so a
 *  session tmux reports no path for is dropped rather than reported
 *  onto no path at all; a persisted worktree session needs no path. */
function classifySession(
  session: TaggedSession,
  ctx: ClassifyContext
):
  | { kind: 'terminal'; terminal: DiscoveredTerminal }
  | { kind: 'persisted'; name: string }
  | null {
  const { name, path } = session;
  if (isTerminalSession(session)) {
    return path
      ? {
          kind: 'terminal',
          terminal: {
            name: terminalSessionKey(name),
            kind: session.type,
            path,
            running: !session.paneDead,
            agent: session.agent,
          },
        }
      : null;
  }
  if (session.repo !== ctx.root) return null;
  const registryName = ctx.byPath.get(
    canonicalWorktreePath(session.worktreePath)
  );
  if (registryName !== undefined)
    return session.paneDead ? null : { kind: 'persisted', name: registryName };
  if (ctx.owned.has(registryNameOf(session)) || !path) return null;
  return {
    kind: 'terminal',
    terminal: {
      name: terminalSessionKey(name),
      kind: 'agent',
      path,
      running: !session.paneDead,
      agent: session.agent,
    },
  };
}

/** The tmux session a registry name stands for in the open
 *  repository, verified by its tags, or `null` — outside a working
 *  tree there is nothing to tag a session with, so nothing to find. */
function resolveOwn(sessionName: string): TaggedSession | null {
  const identity = sessionIdentity(sessionName);
  return identity?.kind === 'worktree'
    ? resolveRegistrySession(identity.repo, sessionName)
    : null;
}

/** Whether the tagged worktree session has a live hosted process. */
export function hasLiveTmuxSession(sessionName: string): boolean {
  if (cachedTmuxStatus && !cachedTmuxStatus.available) return false;
  const session = resolveOwn(sessionName);
  return session !== null && !session.paneDead;
}

/** Resolve a qualified terminal key to its exact tagged tmux target, across
 *  repositories. Adopted orphan worktrees also use terminal keys. */
export function hasPersistedTerminalSession(name: string): boolean {
  if (cachedTmuxStatus && !cachedTmuxStatus.available) return false;
  const identity = sessionIdentity(name);
  return (
    identity?.kind === 'terminal' && resolveSessionByName(identity.id) !== null
  );
}

/** Stop the tagged worktree session even when no local connection exists.
 * Names alone never authorize cleanup: the resolver verifies identity first. */
export function killPersistedTmuxSession(sessionName: string): void {
  const session = resolveOwn(sessionName);
  if (!session) return;
  try {
    tmuxKillSession(session.name);
  } catch {
    // no server / no session — nothing to kill
  }
}
