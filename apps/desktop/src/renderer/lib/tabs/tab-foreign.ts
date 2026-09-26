import { autoOpenKey, itemTabId, type Tab } from './tab-identity.js';
import type { TabsState } from './tabs-model.js';

/**
 * The pass of `sync-items` for agents running in *other* repositories.
 *
 * The host is single-repo: it attaches the open repository's sessions
 * and knows nothing of the rest — but tmux does, and the strip spans
 * repositories. So an agent alive in another checkout gets a tab in
 * that repository's group, exactly the shape a foreign tab has once
 * the user has switched away from it: repository, branch, title, and
 * nothing attached behind it. Activating it opens its repository, and
 * that repository's own scanner attaches the agent.
 */

/** One agent alive elsewhere, as the tab model needs it. */
export interface ForeignSessionEntry {
  /** The repository it runs in — never the one in view. */
  repo: string;
  branch: string;
  /** The checkout the agent belongs to, when the host said. */
  worktree?: string;
  /** Its registry name in that repository, the key its auto-open
   *  history is kept under there. */
  sessionName: string;
  title?: string;
}

/**
 * A tab per agent alive in another repository, once each.
 *
 * Recorded in `autoOpened` under the very key that repository's own
 * sync would use, so switching there later does not open — or, worse,
 * focus — a second time what is already on the strip, and a tab the
 * user closed stays closed while the agent runs on. Focus never moves:
 * this is the restore path at launch, and a tab from another
 * repository taking focus would switch the workspace. An entry for the
 * repository in view is not this pass's business — that repository's
 * sidebar describes its own agents — and is ignored.
 */
export function openForeign(
  state: TabsState,
  repo: string,
  entries: ForeignSessionEntry[]
): TabsState {
  const opened = new Set(state.autoOpened);
  let tabs: Tab[] = state.tabs;
  let changed = false;
  for (const entry of entries) {
    if (entry.repo === repo) continue;
    const seen = autoOpenKey(entry.repo, entry.sessionName);
    if (opened.has(seen)) continue;
    opened.add(seen);
    changed = true;
    if (!hasTabFor(tabs, entry)) tabs = [...tabs, foreignTab(entry)];
  }
  return changed ? { ...state, tabs, autoOpened: [...opened] } : state;
}

/** Whether the strip already shows this agent's item — by key, by the
 *  id the key gives, or by the branch a re-keyed tab was stamped with
 *  (a worktree tab becomes `pr:n` when a pull request appears). */
function hasTabFor(tabs: readonly Tab[], entry: ForeignSessionEntry): boolean {
  const key = `branch:${entry.branch}`;
  const id = itemTabId(entry.repo, key);
  return tabs.some(
    (t) =>
      t.kind === 'item' &&
      t.repo === entry.repo &&
      (t.itemKey === key ||
        t.id === id ||
        t.branch === entry.branch ||
        (!!entry.worktree && t.worktree === entry.worktree))
  );
}

function foreignTab(entry: ForeignSessionEntry): Tab {
  const key = `branch:${entry.branch}`;
  return {
    id: itemTabId(entry.repo, key),
    kind: 'item',
    repo: entry.repo,
    itemKey: key,
    preview: false,
    branch: entry.branch,
    ...(entry.worktree ? { worktree: entry.worktree } : {}),
    title: entry.title ?? entry.branch,
  };
}
