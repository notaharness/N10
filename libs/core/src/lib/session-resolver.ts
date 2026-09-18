import {
  tmuxListSessionsDetailed,
  tmuxListSessionsDetailedWith,
  type MachineExecutor,
  type TmuxSessionInfo,
} from '@n10/terminal-tmux';
import {
  isWorktreeSessionFor,
  LISTED_TAGS,
  registryNameOf,
  taggedSession,
  type TaggedSession,
} from './session-identity.js';

/**
 * The one way a tmux session is found: one `tmux -u list-sessions -F`
 * fork, matched client-side on its tags (never `list-sessions -f`,
 * filtering stays in core; never a composed name).
 * Every attach, exists, kill, adopt and listing in core goes through
 * here, so the rule that an untagged session is foreign is enforced in
 * one place. Never throws: no server, or no tmux, is an empty listing.
 */

function sessionsFromListing(listed: TmuxSessionInfo[]): TaggedSession[] {
  const ours: TaggedSession[] = [];
  for (const info of listed) {
    const session = taggedSession(info);
    if (session) ours.push(session);
  }
  return ours;
}

/** Every session on the server that carries our tags, in tmux's
 *  listing order. */
export function listOurSessions(): TaggedSession[] {
  try {
    return sessionsFromListing(tmuxListSessionsDetailed(LISTED_TAGS));
  } catch {
    return [];
  }
}

/** The remote twin, one round trip through `executor` — the model
 *  `open-session.ts`'s `findSession` follows to discover an existing
 *  remote worktree or terminal before creating a second one (finding
 *  7). Never throws: a machine that cannot be reached, or one with no
 *  tmux server, is an empty listing, exactly like the local resolver. */
export async function listOurSessionsWith(
  executor: MachineExecutor
): Promise<TaggedSession[]> {
  try {
    return sessionsFromListing(
      await tmuxListSessionsDetailedWith(executor, LISTED_TAGS)
    );
  } catch {
    return [];
  }
}

/** The oldest of several sessions, by tmux's creation time. More than
 *  one session for an identity should not happen; when it does, the
 *  one that was there first is the one everything acts on, and the
 *  others are left where they are — listed, never silently killed. */
function oldest(sessions: TaggedSession[]): TaggedSession | null {
  let best: TaggedSession | null = null;
  for (const session of sessions) {
    if (!best || session.created < best.created) best = session;
  }
  return best;
}

/** The worktree session for (repo, branch), or `null`. */
export function resolveWorktreeSession(
  repoRoot: string,
  branch: string,
  sessions: TaggedSession[] = listOurSessions()
): TaggedSession | null {
  return oldest(
    sessions.filter((s) => isWorktreeSessionFor(s, repoRoot, branch))
  );
}

/**
 * One of our sessions with exactly this name, or `null` — any type, any
 * repository, because a tmux name is unique on the server. This is how
 * a caller that holds a tmux name reaches its session: a terminal tab,
 * which belongs to its directory rather than to the open repository
 * and outlives a repository switch; or an orphaned worktree session
 * that a terminal tab has adopted, which keeps its `worktree` tag. The
 * tags still decide "ours": an untagged session of that name is not
 * found. A caller holding a registry *key* must not use this — see
 * {@link resolveRegistrySession}.
 */
export function resolveSessionByName(
  name: string,
  sessions: TaggedSession[] = listOurSessions()
): TaggedSession | null {
  return sessions.find((s) => s.name === name) ?? null;
}

/**
 * The worktree session a PTY-registry key names in this repository:
 * the one whose branch keys to it. This is how a caller that holds
 * only a registry key — the merged-branch sweep, the worktree removal
 * — reaches the resolver without composing a name.
 *
 * Nothing is matched by name here, only tags: `registryNameOf` rebuilds
 * each candidate session's key from its `repo`/`branch` tags (via
 * {@link worktreeSessionKey}, a JSON tuple — see `session-key.ts`) and
 * compares that to `registryName`. A registry key is never a tmux
 * name by construction, so matching on the name directly could answer
 * with an unrelated session that happens to share a label. Callers
 * holding a tmux name — a terminal tab, whose key *is* its name — use
 * {@link resolveSessionByName} instead.
 */
export function resolveRegistrySession(
  repoRoot: string,
  registryName: string,
  sessions: TaggedSession[] = listOurSessions()
): TaggedSession | null {
  return oldest(
    sessions.filter(
      (s) =>
        s.type === 'worktree' &&
        s.repo === repoRoot &&
        registryNameOf(s) === registryName
    )
  );
}
