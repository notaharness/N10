/**
 * What a tab *is*: its shape, and the identities derived from it.
 *
 * Split from the reducer because these are the answers the rest of
 * the app asks about a tab — which repository it belongs to, whether
 * that is the open one — and none of them involve a transition.
 */
import type { TerminalKind } from '../../../host/contract.js';

export type Tab =
  | {
      id: string;
      kind: 'item';
      /** Absolute path of the repository this tab belongs to. Half of
       *  the tab's identity: `branch:main` means a different thing in
       *  each open repo. */
      repo: string;
      itemKey: string;
      preview: boolean;
      /** Last-known git branch, stamped by `sync-items`. The stable
       *  identity a tab falls back on when its itemKey goes stale —
       *  a worktree's key changes from `branch:x` to `pr:n` the moment
       *  a PR appears (and back when it closes). */
      branch?: string;
      /** The worktree checkout the tab's item lives in, stamped by
       *  `sync-items`. A worktree's identity: `git switch` inside it
       *  moves its item to another branch's key, and the tab follows
       *  it here before anything else. */
      worktree?: string;
      /** The branch the tab was opened for, stamped once by
       *  `sync-items` — the branch the worktree's agent session was
       *  created for when it has one. The tab warns while its worktree
       *  is on any other. */
      originBranch?: string;
      /** Last-known display title, stamped by `sync-items`. What the
       *  strip shows once the item is out of reach — its repository is
       *  not the open one, so the sidebar cannot describe it — rather
       *  than falling back to a key. */
      title?: string;
    }
  | { id: 'settings'; kind: 'settings'; preview: false }
  | {
      id: string;
      kind: 'terminal';
      /** Qualified session key — the terminal's identity. */
      name: string;
      terminalKind: TerminalKind;
      cwd: string;
      /** `cwd` with home written as `~`, as the host renders it. */
      displayPath: string;
      /** The repository this terminal's directory is the root of, or
       *  `null` for a plain folder — which belongs to nobody, sits in
       *  the repo-less group, and is never foreign. */
      repo: string | null;
      /** Terminals are always pinned: a preview tab gets replaced by
       *  the next click, and a shell is not something to lose that way. */
      preview: false;
      /** Whether a host listing has named this terminal yet. A tab
       *  opened on the launch's own answer starts out unlisted, and a
       *  listing fetched before the terminal existed says nothing about
       *  it — only a listing that has named it, and then stops, has
       *  seen it end. */
      listed: boolean;
    };

/** A tab that shows a sidebar item, and so belongs to a repository. */
export type ItemTab = Extract<Tab, { kind: 'item' }>;
export type TerminalTab = Extract<Tab, { kind: 'terminal' }>;

/**
 * The id of the tab for `itemKey` in `repo`.
 *
 * Length-prefixed rather than joined on a separator: repository paths
 * and branch names can both contain any punctuation a separator might
 * use, and a collision here is two repos' tabs rendering each other's
 * pane (panes are keyed by tab id).
 */
export function itemTabId(repo: string, itemKey: string): string {
  return `item:${repo.length}:${repo}:${itemKey}`;
}

/**
 * Whether `tab` is the tab for `itemKey` in `repo`: it shows that item
 * now, or it was opened on it (its id) and has since only been
 * re-keyed — `branch:x` growing into `pr:n`. A tab that followed its
 * worktree onto another branch no longer stands for the item it was
 * opened on; that item, left behind in the sidebar, gets a tab of its
 * own.
 */
export function standsFor(tab: Tab, repo: string, itemKey: string): boolean {
  if (tab.kind !== 'item' || tab.repo !== repo) return false;
  if (tab.itemKey === itemKey) return true;
  const movedOff =
    tab.originBranch !== undefined &&
    tab.branch !== undefined &&
    tab.branch !== tab.originBranch;
  return !movedOff && tab.id === itemTabId(repo, itemKey);
}

/**
 * The id opening `itemKey` in `repo` lands on: the tab already
 * standing for it, or a new one. A new tab whose natural id is still
 * held by a tab that moved off it takes a suffixed one — `~` cannot
 * occur in a branch name or a PR key, so the suffix never collides with
 * another item's id. The moved tab keeps its id: panes are keyed by it,
 * and re-iding would remount its terminal.
 */
export function tabIdFor(
  tabs: readonly Tab[],
  repo: string,
  itemKey: string
): string {
  const existing = tabs.find((t) => standsFor(t, repo, itemKey));
  if (existing) return existing.id;
  const base = itemTabId(repo, itemKey);
  const taken = new Set(tabs.map((t) => t.id));
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}~${n}`;
  return id;
}

/** The id of the tab for a terminal session. Session names are unique
 *  across directories and repositories, so the name alone is the key. */
export function terminalTabId(name: string): string {
  return `terminal:${name}`;
}

/** The repository a tab is at home in, or null for one that belongs to
 *  nobody — settings, and a terminal in a plain folder. */
export function tabHome(tab: Tab): string | null {
  return tab.kind === 'settings' ? null : tab.repo;
}

/** Identity of an item tab as a map key — the same pair, unambiguous. */
export function pairKey(tab: Tab): string {
  return tab.kind === 'item' ? itemTabId(tab.repo, tab.itemKey) : tab.id;
}

/** Whether `tab` belongs to a repository other than the open one.
 *  Settings belongs to none, so it is never foreign. */
export function isForeignTab(tab: Tab, repo: string): boolean {
  return foreignRepoOf(tab, repo) !== null;
}

/** The other repository `tab` belongs to, or null when it is at home
 *  — or belongs to nobody, which counts as at home everywhere. */
export function foreignRepoOf(tab: Tab, repo: string): string | null {
  const home = tabHome(tab);
  return home !== null && home !== repo ? home : null;
}

/** Identity of an auto-opened session, unique across repositories. */
export function autoOpenKey(repo: string, sessionName: string): string {
  return `${repo.length}:${repo}:${sessionName}`;
}
