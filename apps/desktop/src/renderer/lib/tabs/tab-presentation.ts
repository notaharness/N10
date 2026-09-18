import type { SidebarItem } from '../../../host/contract.js';
import { itemTitle } from '../sidebar/sidebar-model.js';
import type { Tab } from './tab-identity.js';

/**
 * How the strip presents a set of tabs that spans repositories.
 *
 * Pure, and separate from the strip itself: what reads as "these two
 * tabs belong to different repos" is a property of the sequence, not of
 * either tab, and getting it from a component means recomputing it per
 * tab from the neighbour's props.
 */

/** What a tab is a tab of, as far as its icon is concerned. */
export type TabFace = 'settings' | 'pr' | 'branch' | 'terminal';

/** How many characters of a terminal's directory the tab shows. The
 *  strip truncates from the end (CSS), which for a path hides exactly
 *  the part that tells two directories apart, so the cut is made here
 *  from the front instead. */
const TERMINAL_LABEL_MAX = 24;

/**
 * Shorten a path from the front, so its tail stays readable.
 *
 * Whole segments go first — `…/Code/n10` rather than `…e/Code/n10`
 * — and only when the last segment alone is too long is it cut inside.
 */
export function truncateLeading(path: string, max: number): string {
  if (path.length <= max) return path;
  const segments = path.split('/');
  let tail = '';
  for (let i = segments.length - 1; i > 0; i--) {
    const next = `/${segments[i]}${tail}`;
    if (`…${next}`.length > max) break;
    tail = next;
  }
  if (tail) return `…${tail}`;
  return `…${path.slice(path.length - (max - 1))}`;
}

/**
 * What a tab shows for itself.
 *
 * The item is the live answer, and is preferred: its title follows the
 * pull request as it is renamed. A tab whose item is out of reach — its
 * repository is not the open one, so this sidebar has no row for it —
 * shows the title it was last stamped with, then its branch, and only
 * then the bare key, so a tab never turns back into a slug because the
 * user looked at another repository.
 */
/**
 * `machineLabel`, resolved by the caller (never a peerId — meaning
 * nothing to the user), is `null` for a local tab and omitted from the
 * title entirely: D8 says a user who never pairs anything sees today's
 * tab strip exactly. For a remote one, the machine comes first —
 * `workbox · feature/x` — because when scanning tabs spanning several
 * machines, the machine is the disambiguator (ux-machines.md §6).
 */
export function tabPresentation(
  tab: Tab,
  item: SidebarItem | undefined,
  machineLabel?: string | null
): { label: string; face: TabFace } {
  const base = basePresentation(tab, item);
  if (!machineLabel || tab.kind === 'settings') return base;
  return { ...base, label: `${machineLabel} · ${base.label}` };
}

function basePresentation(
  tab: Tab,
  item: SidebarItem | undefined
): { label: string; face: TabFace } {
  if (tab.kind === 'settings') return { label: 'Settings', face: 'settings' };
  if (tab.kind === 'terminal') {
    return {
      label: truncateLeading(tab.displayPath, TERMINAL_LABEL_MAX),
      face: 'terminal',
    };
  }
  const label =
    (item ? itemTitle(item) : undefined) ??
    tab.title ??
    tab.branch ??
    tab.itemKey.replace(/^[a-z]+:/, '');
  const isPr = item ? Boolean(item.pr) : tab.itemKey.startsWith('pr:');
  return { label, face: isPr ? 'pr' : 'branch' };
}

/** The repository a tab belongs to, or null for a repo-agnostic tab. */
export function tabRepo(tab: Tab): string | null {
  return tab.kind === 'settings' ? null : tab.repo;
}

/** The group a tab sits in on the strip: its repository, the repo-less
 *  group for a plain-folder terminal, or nothing for settings — which
 *  is transparent to grouping. The sentinel cannot collide with a
 *  repository path, which is always absolute. */
const REPOLESS_GROUP = 'repo-less';
function tabGroup(tab: Tab): string | null {
  if (tab.kind === 'settings') return null;
  return tab.repo ?? REPOLESS_GROUP;
}

/** The short name a repository goes by on screen: its directory name. */
export function repoDisplayName(cwd: string): string {
  const parts = cwd.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? cwd;
}

/**
 * Which tabs start a new group, positionally.
 *
 * A tab starts a group when the nearest grouped tab to its left is in
 * a different one — so the leftmost group never draws a separator, and
 * the settings tab (which belongs to no group) neither starts one nor
 * breaks the one it sits in. Plain-folder terminals form a group of
 * their own, apart from every repository's.
 */
export function repoGroupStarts(tabs: readonly Tab[]): boolean[] {
  let previous: string | null = null;
  return tabs.map((tab) => {
    const group = tabGroup(tab);
    if (group === null) return false;
    const starts = previous !== null && previous !== group;
    previous = group;
    return starts;
  });
}
