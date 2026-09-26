import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import type { CategorizedReviews, PullRequestInfo } from '@n10/vcs-core';

import type { SidebarItem } from '@n10/core';
import { getItemKey, getPrFromItem, isItemActive } from '@n10/core';
import { buildSidebarItems } from '@n10/core';
import { useSessionData } from './SessionContext.js';
import { useConfig } from './ConfigContext.js';

/**
 * Pure resolver for the sidebar's selected index.
 *
 * If the selected key is present in the current items array, return
 * its index. If it's missing (e.g. the item was deleted), fall back
 * to the last valid index clamped to the new list length so the
 * cursor lands on a nearby row. Empty / null-key case returns 0.
 *
 * Extracted so it can be tested without spinning up the full provider
 * tree (SessionContext pulls live git state in).
 */
export function resolveSelectedIndex(
  items: SidebarItem[],
  selectedKey: string | null,
  lastValidIndex: number
): number {
  if (!selectedKey || items.length === 0) return 0;
  const idx = items.findIndex((item) => getItemKey(item) === selectedKey);
  if (idx >= 0) return idx;
  return Math.min(Math.max(0, lastValidIndex), items.length - 1);
}

/**
 * The sidebar's selection anchor.
 *
 * `key` is the identity of the selected row; `index` is the row it
 * resolved to the last time the list was looked at. Both travel
 * together so a delete has somewhere to land: when `key` is gone from
 * `items`, `index` says where it used to be.
 */
export interface SidebarSelection {
  key: string | null;
  index: number;
}

export const INITIAL_SELECTION: SidebarSelection = { key: null, index: 0 };

/**
 * Re-anchor a selection against a new `items` array.
 *
 * Resolves the anchor (key first, index as the delete fallback) and
 * then adopts whatever row that landed on, so the *next* list change
 * follows the row the cursor is actually sitting on rather than the
 * key of a row that no longer exists. Without the adoption step, a
 * delete followed by a re-sort would drag the cursor back to a stale
 * numeric position.
 *
 * Returns the input object unchanged when nothing moved — the caller
 * uses that identity to skip a redundant state write.
 */
export function reconcileSelection(
  items: SidebarItem[],
  selection: SidebarSelection
): SidebarSelection {
  const index = resolveSelectedIndex(items, selection.key, selection.index);
  const item = items[index];
  const key = item ? getItemKey(item) : null;
  if (key === selection.key && index === selection.index) return selection;
  return { key, index };
}

/**
 * Resolve an explicitly requested key (`selectByKey`) against a list,
 * without adopting anything: the requested key stays the anchor even
 * when no row carries it.
 *
 * A key that isn't in the list yet (the branch picker selects a
 * session the moment it's created, before the sidebar has refreshed)
 * keeps the current row under the cursor and waits — the key wins as
 * soon as its row appears.
 */
export function selectionForKey(
  items: SidebarItem[],
  key: string,
  current: SidebarSelection
): SidebarSelection {
  const index = items.findIndex((item) => getItemKey(item) === key);
  return { key, index: index >= 0 ? index : current.index };
}

/**
 * Translate a `session:${name}` key to a `review:${prId}` key when
 * the session is hidden from the sessions list because its branch
 * has a review PR (see `buildSidebarItems` — sessions whose branch
 * is in any of `categorizedReviews` are skipped, and only the
 * `review-pr` row is shown). Returns the input key unchanged for
 * non-session keys or for sessions whose row IS rendered as
 * `session`.
 *
 * Without this translation, callers like the branch picker call
 * `selectByKey('session:${name}')` after creating a session, the
 * key matches no item, and `resolveSelectedIndex` falls back to
 * `lastValidIndex` — which lands on whatever neighboring row
 * happens to share that index (a brittle coincidence that breaks
 * whenever the sidebar shape shifts).
 */
export function translateSelectKey(
  key: string,
  sessionBranchMap: Map<string, string>,
  categorizedReviews: CategorizedReviews
): string {
  if (!key.startsWith('session:')) return key;
  const sessionName = key.slice('session:'.length);
  const branch = sessionBranchMap.get(sessionName);
  if (!branch) return key;
  // The review PR is looked up by branch, the same test `buildSidebarItems`
  // folds on — not through the session's own PR data, which resolves
  // seconds after the worktree exists and would leave a just-created
  // session's key unmatched until then.
  const reviewPr = [
    ...categorizedReviews.needsReview,
    ...categorizedReviews.waitingForAuthor,
    ...categorizedReviews.approvedByYou,
  ].find((p) => p.sourceBranch === branch);
  return reviewPr ? `review:${reviewPr.id}` : key;
}

/**
 * Where the cursor is for this render: the requested key, translated
 * for this render's maps, anchored against the committed list.
 * `listChanged` selects reconciliation (follow the row, adopt on a
 * miss) over plain key resolution — see the provider for why the two
 * are kept apart. Both are idempotent, so this settles.
 */
export function anchorSelection(
  items: SidebarItem[],
  selection: SidebarSelection,
  translatedKey: string | null,
  listChanged: boolean
): SidebarSelection {
  const requested =
    translatedKey === selection.key
      ? selection
      : { key: translatedKey, index: selection.index };
  if (listChanged) return reconcileSelection(items, requested);
  if (requested.key !== null) {
    return selectionForKey(items, requested.key, requested);
  }
  return requested;
}

export interface SidebarContextValue {
  items: SidebarItem[];
  /** Resolved numeric index for rendering. Derived from selectedKey + items. */
  selectedIndex: number;
  selectedItem: SidebarItem | undefined;
  selectedPr: PullRequestInfo | undefined;
  /** Session name to use for terminal: branch-based name for all item kinds. */
  sessionNameForTerminal: string | null;
  /** The selected worktree row's label — its branch as checked out now,
   *  which its session key (the checkout) does not carry. */
  selectedRowLabel: string | null;
  totalItems: number;
  /** Select a sidebar item by its stable identity key. */
  selectByKey: (key: string) => void;
  /** Move selection by a relative offset (positive = down, negative = up). */
  moveSelection: (offset: number) => void;
  /** Jump to the next/previous active (running) item. No-op if none found. */
  moveSelectionToActive: (direction: 1 | -1) => void;
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

export function SidebarProvider({ children }: { children: ReactNode }) {
  const sessionCtx = useSessionData();
  const { vcsConfigured } = useConfig();
  // Sole source of truth for what's selected: the row's identity key
  // plus the index it last resolved to, which is what a delete falls
  // back to. The render below anchors both against the current list.
  const [selection, setSelection] =
    useState<SidebarSelection>(INITIAL_SELECTION);
  // The `items` array `selection` was last anchored against. `null`
  // until the first render has reconciled.
  const [anchoredItems, setAnchoredItems] = useState<SidebarItem[] | null>(
    null
  );

  const items = useMemo(
    () =>
      buildSidebarItems(
        sessionCtx.sortedSessions,
        vcsConfigured ? sessionCtx.orphanPrs : [],
        vcsConfigured
          ? sessionCtx.categorizedReviews
          : { needsReview: [], waitingForAuthor: [], approvedByYou: [] },
        sessionCtx.sessionBranchMap,
        sessionCtx.sessionPrMap,
        sessionCtx.mergedBranches,
        sessionCtx.conflictCounts
      ),
    [
      sessionCtx.sortedSessions,
      sessionCtx.orphanPrs,
      sessionCtx.categorizedReviews,
      sessionCtx.sessionBranchMap,
      sessionCtx.sessionPrMap,
      sessionCtx.mergedBranches,
      sessionCtx.conflictCounts,
      vcsConfigured,
    ]
  );

  const totalItems = items.length;

  // ── Anchor the selection against the committed `items` ───────────
  // React's "adjust state while rendering" pattern, doing two separate
  // jobs — rather than an effect that has to be lied to about its deps
  // to keep from looping.
  //
  // Every render re-resolves the anchor key against the list that is
  // actually committed. That has to happen here and not in the
  // callback that asked for the row: a callback closes over the
  // `items` of the render that created it, and the callers that matter
  // hold one across awaited git work (branch picker, plan checkout,
  // confirm dialogs), by which time a refresh has published a
  // different list. Resolving there would resolve against a list
  // nobody is looking at any more.
  //
  // Adoption — taking the row the anchor landed on as the new key — is
  // the part that only makes sense when the list itself changed, so a
  // delete followed by a re-sort follows the row the cursor is sitting
  // on instead of dragging it back to a stale numeric position.
  //
  // Both helpers are idempotent, so the state write settles on the
  // next pass rather than looping.
  // The requested key is translated here, against the maps of this
  // render, for the same reason: `selectByKey('session:x')` right
  // after a worktree was created for a PR branch runs from a callback
  // whose maps predate the refresh, so translating there would miss
  // the `review:<id>` row the branch is folded into. Idempotent, so it
  // settles with the anchor.
  const translatedKey =
    selection.key === null
      ? null
      : translateSelectKey(
          selection.key,
          sessionCtx.sessionBranchMap,
          sessionCtx.categorizedReviews
        );
  const listChanged = anchoredItems !== items;
  const current = anchorSelection(items, selection, translatedKey, listChanged);
  if (listChanged) setAnchoredItems(items);
  if (current.key !== selection.key || current.index !== selection.index) {
    setSelection(current);
  }

  const selectedIndex = current.index;

  // ── Derived values (cheap — no useMemo needed) ───────────────────
  const selectedItem = items[selectedIndex];
  const selectedPr = selectedItem ? getPrFromItem(selectedItem) : undefined;
  const sessionNameForTerminal = !selectedItem
    ? null
    : selectedItem.kind === 'session'
    ? selectedItem.session.name
    : selectedItem.sessionName ?? null;
  const selectedRowLabel =
    selectedItem?.kind === 'session'
      ? selectedItem.session.label ?? null
      : null;

  // ── Navigation helpers ───────────────────────────────────────────
  const selectByKey = useCallback((key: string) => {
    // Stores the key only — which row owns it (and how a session key
    // translates to its review row) is a question about the committed
    // list, and the render above is the only place that knows which
    // list that is.
    setSelection((prev) =>
      prev.key === key ? prev : { key, index: prev.index }
    );
  }, []);

  const moveSelection = useCallback(
    (offset: number) => {
      const newIdx = Math.max(
        0,
        Math.min(selectedIndex + offset, items.length - 1)
      );
      const item = items[newIdx];
      if (item) {
        setSelection({ key: getItemKey(item), index: newIdx });
      }
    },
    [items, selectedIndex]
  );

  const moveSelectionToActive = useCallback(
    (direction: 1 | -1) => {
      for (
        let i = selectedIndex + direction;
        i >= 0 && i < items.length;
        i += direction
      ) {
        const item = items[i];
        if (item && isItemActive(item)) {
          setSelection({ key: getItemKey(item), index: i });
          return;
        }
      }
    },
    [items, selectedIndex]
  );

  const value = useMemo<SidebarContextValue>(
    () => ({
      items,
      selectedIndex,
      selectedItem,
      selectedPr,
      sessionNameForTerminal,
      selectedRowLabel,
      totalItems,
      selectByKey,
      moveSelection,
      moveSelectionToActive,
    }),
    [
      items,
      selectedIndex,
      selectedItem,
      selectedPr,
      sessionNameForTerminal,
      selectedRowLabel,
      totalItems,
      selectByKey,
      moveSelection,
      moveSelectionToActive,
    ]
  );

  return (
    <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>
  );
}

export function useSidebar(): SidebarContextValue {
  const ctx = useContext(SidebarContext);
  if (!ctx) throw new Error('useSidebar must be used within SidebarProvider');
  return ctx;
}
