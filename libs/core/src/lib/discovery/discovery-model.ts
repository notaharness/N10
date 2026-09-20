/**
 * The pure half of external-session discovery: what one scan saw, and
 * what changed since the last one.
 *
 * Kept apart from the scanner so the interesting decisions — what
 * counts as newly appeared, what is safe to attach to, what has gone
 * away — are testable without git, tmux, timers or a filesystem.
 */

/** One n10-owned worktree, as a scan saw it. */
export interface DiscoveredWorktree {
  /** Qualified core key — `keyForWorktree(wt)`. */
  name: string;
  /** Short branch name, or `''` for a detached-HEAD orphan. */
  branch: string;
  /** Absolute path of the checkout. */
  path: string;
}

/** One terminal-tab session, as a scan saw it. Identified entirely by
 *  what tmux holds: the kind is the session-type tag, the directory is
 *  the session's own `session_path`. */
export interface DiscoveredTerminal {
  /** Qualified terminal key containing the actual tmux attachment target. */
  name: string;
  kind: 'shell' | 'agent';
  running?: boolean;
  agent?: string;
  /** Absolute directory the session runs in. */
  path: string;
  /** The pull request this session is reviewing in the background,
   *  when it is one. A review is an `agent` terminal like any other;
   *  this is what tells the two apart. */
  review?: string;
  /** The branch a review session runs against. */
  branch?: string;
}

/** Everything one scan observed about the world outside this process. */
export interface DiscoveryScan {
  /** Every worktree git reports under the resolver's directory. */
  worktrees: DiscoveredWorktree[];
  /** The subset of those names that have a live tmux session belonging
   *  to this repository. */
  persisted: ReadonlySet<string>;
  /** Every surviving terminal-tab session, wherever it runs. Empty for
   *  a shell that has no terminal tabs to attach them to. */
  terminals: DiscoveredTerminal[];
}

/** What changed between two scans. */
export interface DiscoveryDelta {
  /** Worktrees this scan reports that the previous one did not. */
  appeared: DiscoveredWorktree[];
  /** Session names whose worktree is no longer there. */
  disappeared: string[];
  /** External sessions to attach to: a live tmux session this process
   *  holds no live PTY for. */
  adoptable: DiscoveredWorktree[];
  /** Names whose tmux session was there last scan and is not now —
   *  an agent killed from outside, so anything showing it as running
   *  is stale. */
  ended: string[];
  /** Terminal sessions to attach to: live in tmux, no PTY here. */
  adoptableTerminals: DiscoveredTerminal[];
  /** Terminal names whose tmux session was there last scan and is not
   *  now. */
  endedTerminals: string[];
  /** True when any of the above is non-empty: the shell's view of
   *  sessions is out of date and should be re-read. */
  changed: boolean;
}

const EMPTY_SCAN: DiscoveryScan = {
  worktrees: [],
  persisted: new Set(),
  terminals: [],
};

/**
 * Diff two scans.
 *
 * `previous` is `null` for the very first scan of a repository, and
 * that case is deliberately not "everything appeared": both shells load
 * their own worktree list at startup, so announcing the initial set
 * would only buy a redundant refresh. `adoptable` is still computed —
 * it reads absolute state, not the diff — which is what makes the first
 * scan reattach to sessions that survived a previous run.
 *
 * `adoptable` otherwise reads absolute state rather than the diff, so an
 * attach that failed is simply offered again next scan. `suppressed`
 * is how the scanner retires one that has failed too often — and it is
 * taken here, rather than filtered by the caller afterwards, so that
 * `changed` cannot claim there is work to do when every offer has been
 * retired. Announcing on a suppressed name meant a permanently
 * unattachable session refreshed both shells on every tick, forever.
 *
 * `ended` is a set difference over `persisted` rather than a test
 * against the local registry: detaching a client does not end its session.
 */
export function diffScans(
  previous: DiscoveryScan | null,
  next: DiscoveryScan,
  isAlive: (name: string) => boolean,
  suppressed: ReadonlySet<string> = new Set(),
  isHeld: (name: string) => boolean = isAlive
): DiscoveryDelta {
  const base = previous ?? EMPTY_SCAN;
  const before = new Set(base.worktrees.map((wt) => wt.name));
  const now = new Set(next.worktrees.map((wt) => wt.name));

  const appeared =
    previous === null
      ? []
      : next.worktrees.filter((wt) => !before.has(wt.name));
  const disappeared = [...before].filter((name) => !now.has(name));
  const adoptable = next.worktrees.filter(
    (wt) =>
      next.persisted.has(wt.name) &&
      !isAlive(wt.name) &&
      !suppressed.has(wt.name)
  );
  const ended = [...base.persisted].filter((name) => !next.persisted.has(name));

  // Terminals have no worktree to appear through, so they only ever
  // read as absolute state: offered until attached, ended when gone.
  const adoptableTerminals = next.terminals.filter(
    (t) =>
      !(t.running === false ? isHeld(t.name) : isAlive(t.name)) &&
      !suppressed.has(t.name)
  );
  const liveTerminals = new Set(next.terminals.map((t) => t.name));
  const endedTerminals = base.terminals
    .map((t) => t.name)
    .filter((name) => !liveTerminals.has(name));

  return {
    appeared,
    disappeared,
    adoptable,
    ended,
    adoptableTerminals,
    endedTerminals,
    changed:
      appeared.length > 0 ||
      disappeared.length > 0 ||
      adoptable.length > 0 ||
      ended.length > 0 ||
      adoptableTerminals.length > 0 ||
      endedTerminals.length > 0,
  };
}
