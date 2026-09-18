import { LOCAL_MACHINE, worktreeSessionKey } from '../session-key.js';
import { existsSync } from 'node:fs';

import type { TaggedSession } from '../session-identity.js';
import { listOurSessions } from '../session-resolver.js';
import { readWorktreeHead, type WorktreeHead } from './worktree-origin.js';

/**
 * Every worktree agent session alive in tmux, whichever repository it
 * belongs to.
 *
 * The scanner in `session-discovery.ts` answers for the open repository
 * only, and it attaches what it finds. This is the wider question a
 * tab strip that spans repositories asks at launch: which agents are
 * running *anywhere*, so each can have its tab back in its own group
 * without being attached to. The tmux server is the whole record: the
 * tags say the session is ours and which repository and branch it was
 * spawned for, `session_path` is the worktree, and the worktree's HEAD
 * says whether it is still on that branch.
 */
export interface LiveWorktreeSession {
  /** The tmux session name — a label, never parsed. */
  tmuxName: string;
  /** The worktree directory, from tmux. */
  path: string;
  /** The main checkout the worktree belongs to — real path, as `git
   *  rev-parse --show-toplevel` prints it, from `@orchestra-repo`. */
  repoRoot: string;
  /** The branch checked out in the worktree, which is the one the
   *  session was spawned under: a worktree that has moved on is left
   *  out. */
  branch: string;
  /** `branch` is the directory's name because no branch is checked
   *  out — see `WorktreeHead.detached`. */
  detached: boolean;
  /** The registry name the session runs under in its repository
   *  (`worktreeSessionKey`), the key its tab's auto-open history uses. */
  sessionName: string;
  /** The machine the session lives on — `'local'` or a beam peerId,
   *  stamped by whoever listed it. */
  machine: string;
  /** Orchestra's tags, when the session carries them. The harness
   *  running in the pane. */
  agent?: string;
  /** The player's reporting target, `codex:<id>` or `tmux:<session>`. */
  orchestrator?: string;
  /** `<KIND> <ISO-8601 UTC>` of the last report the player delivered. */
  lastReport?: string;
}

/** The seams a listing depends on, injectable for tests. */
export interface LiveWorktreeSessionDeps {
  exists?: (path: string) => boolean;
  readHead?: (path: string) => WorktreeHead | null;
  sessions?: () => TaggedSession[];
}

/**
 * List them. Empty when tmux is not the backend in force — the same
 * gate the scanner uses, read from the config handed in — or there is
 * no server.
 *
 * A session counts only when everything agrees: it is a tagged
 * `worktree` session, its directory still exists and has a HEAD to
 * read, and that HEAD is on the branch the session is tagged with (or
 * is detached in the directory the tag names). The tag records what
 * the session was *spawned* under; a worktree whose agent has since
 * checked out another branch is the orphan case, left to the scanner
 * of its own repository, which surfaces it as a terminal tab there. No
 * git is forked: the repository is the tag's to say, and a session
 * without tags is foreign, not a question for git. Never throws.
 */
export function listLiveWorktreeSessions(
  deps: LiveWorktreeSessionDeps = {}
): LiveWorktreeSession[] {
  const resolved = {
    exists: deps.exists ?? existsSync,
    readHead: deps.readHead ?? readWorktreeHead,
  };
  const found: LiveWorktreeSession[] = [];
  for (const session of (deps.sessions ?? listOurSessions)()) {
    const live = describeSession(session, resolved);
    if (live) found.push(live);
  }
  return found;
}

/** One tagged session as a live worktree session, or `null` when it
 *  is not one — a terminal tab, a pathless line, a directory that is
 *  gone, or a worktree that has moved to another branch. */
function describeSession(
  session: TaggedSession,
  deps: Required<Omit<LiveWorktreeSessionDeps, 'sessions'>>
): LiveWorktreeSession | null {
  if (session.paneDead || session.type !== 'worktree' || !session.path)
    return null;
  // `exists`/`readHead` are this machine's filesystem, synchronously —
  // fine while `deps.sessions` only ever lists local tmux (the default
  // above), but `session.path` is meaningless read locally for a
  // session whose own tag says it lives elsewhere (finding 11): a
  // remote `listOurSessionsWith` feeding this would otherwise have
  // every one of its sessions rejected as "directory gone", read
  // against the wrong filesystem. Excluding it is the honest answer
  // until this can honour the machine (an async stat/HEAD read through
  // its executor) — refusing loudly beats reading the wrong
  // filesystem, and this function's own contract already excludes for
  // ordinary reasons (paneDead, wrong type, no path) the same way.
  if (session.machine !== LOCAL_MACHINE) return null;
  if (!deps.exists(session.path)) return null;
  const head = deps.readHead(session.path);
  if (!head || head.branch !== session.branch) return null;
  return {
    tmuxName: session.name,
    path: session.path,
    repoRoot: session.repo,
    branch: head.branch,
    detached: head.detached,
    sessionName: worktreeSessionKey(head.branch, session.repo, session.machine),
    machine: session.machine,
    ...orchestraFields(session),
  };
}

/** Orchestra's own tags, carried along when set. */
function orchestraFields(
  session: TaggedSession
): Pick<LiveWorktreeSession, 'agent' | 'orchestrator' | 'lastReport'> {
  const { agent, orchestrator, lastReport } = session;
  return {
    ...(agent ? { agent } : {}),
    ...(orchestrator ? { orchestrator } : {}),
    ...(lastReport ? { lastReport } : {}),
  };
}
