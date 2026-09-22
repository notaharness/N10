import {
  worktreeSessionKey,
  terminalSessionKey,
  LOCAL_MACHINE,
} from './session-key.js';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import type { TmuxSessionInfo } from '@n10/terminal-tmux';

/**
 * What a tmux session *is*, and what it is merely *called*.
 *
 * Names are labels, tags are identity. A session's name is chosen once
 * at creation, for a human reading `tmux ls`, and never parsed: every
 * lookup — attach, exists, kill, adopt, list — goes through the
 * session user options ("tags") below, which both n10 and Orchestra
 * write on the sessions they create and read on each other's. A
 * session whose name n10 would have chosen but that lacks the tags is
 * foreign: never attached to, killed, adopted or listed.
 *
 * Tags: `set-option -t '=<name>:' @orchestra-x value` to write,
 * `#{@orchestra-x}` in a format string to read. They die with the
 * session and need no file. A value is a plain string without tabs;
 * an absent tag is unset, never a sentinel.
 */
export const ORCHESTRA_TAG = {
  /** `n10` or `orchestra`: whichever program created the session. */
  spawner: '@orchestra-spawner',
  /** The absolute, symlink-resolved path of the main checkout — what
   *  `git rev-parse --show-toplevel` prints there. */
  repo: '@orchestra-repo',
  /** `worktree`, `shell` or `agent` — see {@link SessionType}. */
  sessionType: '@orchestra-session-type',
  /** `worktree` sessions only: the branch the session was spawned
   *  under, unsanitized (`feature/x`); a detached-HEAD worktree's
   *  directory name. */
  branch: '@orchestra-branch',
  /** Orchestra's: the harness in the pane (`claude`, `codex`, …). */
  agent: '@orchestra-agent',
  /** Orchestra's: the player's reporting target. */
  orchestrator: '@orchestra-orchestrator',
  /** Orchestra's: `<KIND> <ISO-8601 UTC>` of the last delivered report. */
  lastReport: '@orchestra-last-report',
} as const;

/** Every tag a listing asks tmux for, in the one fork. */
export const LISTED_TAGS: readonly string[] = Object.values(ORCHESTRA_TAG);

/** What n10 writes as `@orchestra-spawner` on the sessions it creates. */
export const N10_SPAWNER = 'n10';

/**
 * - `worktree`: an agent bound to one git worktree and branch (n10's
 *   worktree sessions, Orchestra's players). Identity = (repo, branch).
 * - `shell` / `agent`: a n10 terminal tab — the user's shell, or an
 *   agent CLI not bound to a worktree. Identity = the name, which is
 *   unique on the server and stable for the session's life.
 */
export type SessionType = 'worktree' | 'shell' | 'agent';

const SESSION_TYPES: ReadonlySet<string> = new Set<SessionType>([
  'worktree',
  'shell',
  'agent',
]);

/** One of our sessions, as the tags describe it. */
export interface TaggedSession {
  /** The tmux name — a label, never parsed. */
  name: string;
  /** `#{session_created}`, epoch seconds: orders two sessions that
   *  claim one identity. */
  created: number;
  paneDead: boolean;
  exitCode?: number;
  /** `#{session_path}` — the directory the session runs in. */
  path: string;
  spawner: string;
  repo: string;
  type: SessionType;
  /** Set on `worktree` sessions; `''` when the tag is missing. */
  branch: string;
  agent?: string;
  orchestrator?: string;
  lastReport?: string;
  /** The machine this session lives on — a beam `peerId`, or `'local'`.
   *  Set by whoever listed the session: the local resolver always says
   *  `'local'`; a remote poller (D3) stamps its peerId. Tags themselves
   *  carry no machine — `@orchestra-repo` holds the path as it exists
   *  on this machine, whichever one that is. */
  machine: string;
}

/** Orchestra's own tags, carried along only when set. Split out of
 *  {@link taggedSession} to keep its own complexity within budget. */
function orchestraTagFields(
  tags: Record<string, string>
): Pick<TaggedSession, 'agent' | 'orchestrator' | 'lastReport'> {
  const agent = tags[ORCHESTRA_TAG.agent];
  const orchestrator = tags[ORCHESTRA_TAG.orchestrator];
  const lastReport = tags[ORCHESTRA_TAG.lastReport];
  return {
    ...(agent ? { agent } : {}),
    ...(orchestrator ? { orchestrator } : {}),
    ...(lastReport ? { lastReport } : {}),
  };
}

/**
 * Read a listed session's tags, or `null` when it is not one of ours:
 * "ours" is `@orchestra-spawner` set and `@orchestra-session-type` one
 * of the known values; worktrees also require a nonempty repo tag.
 * Nothing about the name is consulted.
 */
export function taggedSession(
  info: TmuxSessionInfo,
  machine: string = LOCAL_MACHINE
): TaggedSession | null {
  const tags = info.options ?? {};
  const spawner = tags[ORCHESTRA_TAG.spawner];
  const type = tags[ORCHESTRA_TAG.sessionType];
  const repo = tags[ORCHESTRA_TAG.repo];
  if (!spawner || !type || !SESSION_TYPES.has(type)) return null;
  if (type === 'worktree' && !repo) return null;
  return {
    name: info.name,
    created: info.created,
    paneDead: info.paneDead,
    exitCode: info.exitCode,
    path: info.path,
    spawner,
    repo: repo ?? '',
    type: type as SessionType,
    branch: tags[ORCHESTRA_TAG.branch] ?? '',
    machine,
    ...orchestraTagFields(tags),
  };
}

/** The worktree session for a repository and branch: string equality
 *  on the symlink-resolved repo path and on the unsanitized branch. */
export function isWorktreeSessionFor(
  session: TaggedSession,
  repoRoot: string,
  branch: string
): boolean {
  return (
    session.type === 'worktree' &&
    session.repo === repoRoot &&
    session.branch === branch
  );
}

/** A terminal tab (`shell` or `agent`). */
export function isTerminalSession(
  session: TaggedSession
): session is TaggedSession & { type: 'shell' | 'agent' } {
  return session.type === 'shell' || session.type === 'agent';
}

/**
 * The PTY-registry key a session answers to in its own repository:
 * a worktree session is keyed by `worktreeSessionKey(branch)`, the
 * key both shells spawn it under; a terminal tab by its tmux name,
 * which discovery learns from the listing.
 */
export function registryNameOf(session: TaggedSession): string {
  return session.type === 'worktree'
    ? worktreeSessionKey(session.branch, session.repo, session.machine)
    : terminalSessionKey(session.name, session.machine);
}

/** The tags n10 writes on a session it creates. */
export function sessionTags(
  repoRoot: string,
  identity: { type: 'worktree'; branch: string } | { type: 'shell' | 'agent' }
): Record<string, string> {
  return {
    [ORCHESTRA_TAG.spawner]: N10_SPAWNER,
    [ORCHESTRA_TAG.repo]: repoRoot,
    [ORCHESTRA_TAG.sessionType]: identity.type,
    ...(identity.type === 'worktree'
      ? { [ORCHESTRA_TAG.branch]: identity.branch }
      : {}),
  };
}

// ── Labels ────────────────────────────────────────────────────────
//
// The rule both programs implement (Orchestra in bash, pinned as a
// table in Orchestra's tests/test_port.py and in session-identity.spec.ts):
// the preferred label is `<basename(repo)>-<branch>` (or `-shell` /
// `-agent`) with every `/`, `.` and `:` replaced by `-`, capped at 200
// characters. On overflow the label is the first 195 characters, `-`,
// and the first four hex digits of the SHA-256 of the *unsanitized*
// `<basename>-<branch>` string — the same "hash what you were given"
// rule the tmux lib's own sanitizer follows for the raw names it caps.

/** Every character tmux refuses in a name, plus `/`, which it accepts
 *  but which reads as a target separator to a human. */
const REPLACED = /[/.:]/g;
const MAX_LABEL = 200;
const HASH_TAIL = 4;

/** `sanitize(x)` from the shared convention, without the cap: the cap
 *  applies to the assembled name, not to each part. */
export function sanitizeLabelPart(part: string): string {
  return part.replace(REPLACED, '-');
}

/** `<basename>-<rest>`, sanitized and capped. */
function sessionLabel(repoRoot: string, rest: string): string {
  const raw = `${basename(repoRoot)}-${rest}`;
  const replaced = sanitizeLabelPart(raw);
  if (replaced.length <= MAX_LABEL) return replaced;
  const hash = createHash('sha256').update(raw).digest('hex');
  return `${replaced.slice(0, MAX_LABEL - HASH_TAIL - 1)}-${hash.slice(
    0,
    HASH_TAIL
  )}`;
}

/** `<repo basename>-<branch>` — e.g. `n10-feature-x`. */
export function worktreeSessionLabel(repoRoot: string, branch: string): string {
  return sessionLabel(repoRoot, branch);
}

/** `<repo basename>-shell` or `<repo basename>-agent`. */
export function terminalSessionLabel(
  repoRoot: string,
  kind: 'shell' | 'agent'
): string {
  return sessionLabel(repoRoot, kind);
}
