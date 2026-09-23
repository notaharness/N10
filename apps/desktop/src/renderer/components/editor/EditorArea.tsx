import { useDeferredValue, useMemo } from 'react';
import type { SidebarItem } from '../../../host/contract.js';
import { useRepo } from '../../lib/repo-context.js';
import { useSessionActivity, useTerminals } from '../../lib/data/queries.js';
import {
  itemBranch,
  itemKey,
  itemSessionName,
} from '../../lib/sidebar/sidebar-model.js';
import { foreignRepoOf, useTabs, type Tab } from '../../lib/tabs/tabs.js';
import { repoGroupStarts } from '../../lib/tabs/tab-presentation.js';
import { useCloseTabs } from '../../lib/tabs/use-close-tabs.js';
import { cn } from '../../lib/utils.js';
import { ErrorBoundary } from '../ErrorBoundary.js';
import { EmptyState } from './EmptyState.js';
import { SettingsView } from './lazy-panes.js';
import { ItemView } from './ItemView.js';
import { ForeignRepoPane } from './ForeignRepoPane.js';
import { TabButton } from './TabButton.js';
import { TerminalView } from './TerminalView.js';

/** The pane body for a tab. Each kind renders its own placeholder
 *  while its module lands; nothing here suspends. */
function PaneBody({
  tab,
  item,
  items,
  active,
  onPin,
}: {
  tab: Tab;
  item: SidebarItem | undefined;
  items: SidebarItem[];
  active: boolean;
  onPin: () => void;
}) {
  if (tab.kind === 'settings') return <SettingsView />;
  if (tab.kind === 'terminal')
    return <TerminalView tab={tab} active={active} />;
  return (
    <ItemView
      item={item}
      items={items}
      itemKey={tab.itemKey}
      active={active}
      onPin={onPin}
    />
  );
}

/**
 * Tab strip + stacked panes. Every open tab stays mounted (panes are
 * absolutely positioned and hidden with `visibility`, not unmounted)
 * so running terminals keep their scrollback and PR views keep their
 * scroll position when you switch away and back.
 */
export function EditorArea({
  items,
  onOpenPalette,
}: {
  items: SidebarItem[];
  onOpenPalette: () => void;
}) {
  const { repo } = useRepo();
  const tabs = useTabs();
  const closer = useCloseTabs(items);
  const activity = useSessionActivity(repo.cwd);
  const terminals = useTerminals();
  const terminalRunning = useMemo(
    () =>
      new Set(
        (terminals.data ?? []).filter((t) => t.running).map((t) => t.name)
      ),
    [terminals.data]
  );
  const byKey = useMemo(
    () => new Map(items.map((i) => [itemKey(i), i])),
    [items]
  );
  const byBranch = useMemo(
    () => new Map(items.map((i) => [itemBranch(i), i])),
    [items]
  );

  /**
   * The sidebar item a tab is showing.
   *
   * Falls back to the tab's stamped branch when its key doesn't resolve:
   * an item re-keys the moment a PR appears (`branch:x` → `pr:42`), and
   * `sync-items` only catches up in an effect — one render happens
   * first. Looking up by key alone would make that render treat the tab
   * as itemless, which unmounts the pane and destroys a live agent's
   * terminal (its scrollback only partly recoverable from the host's
   * ring buffer) twice over a PR's life.
   */
  const itemFor = (tab: Tab): SidebarItem | undefined => {
    // A tab from another repository resolves to nothing here on
    // purpose: `items` describes the open repo, and a shared branch
    // name would otherwise hand that tab this repo's worktree, its
    // agent and its diff.
    if (tab.kind !== 'item' || tab.repo !== repo.cwd) return undefined;
    return (
      byKey.get(tab.itemKey) ??
      (tab.branch ? byBranch.get(tab.branch) : undefined)
    );
  };

  const sessionNameFor = (tab: Tab): string | undefined => {
    // A terminal's session is the tab itself — always mounted, so its
    // scrollback survives switching away.
    if (tab.kind === 'terminal') return tab.name;
    const item = itemFor(tab);
    if (!item) return undefined;
    const branch = itemBranch(item);
    for (const i of items) {
      const name = itemSessionName(i);
      if (name && itemBranch(i) === branch) return name;
    }
    return undefined;
  };

  // The tab strip tracks the live state so clicks feel instant; the
  // panes below follow a *deferred* copy, so mounting/unmounting a
  // pane runs as an interruptible background render instead of
  // blocking the click. No blanket overlay: the virtualized diff and
  // the rail each show their own skeletons, and the terminal renders
  // in the first frame.
  const paneTabs = useDeferredValue(tabs.tabs);
  const paneActiveId = useDeferredValue(tabs.activeId);
  const groupStarts = useMemo(() => repoGroupStarts(tabs.tabs), [tabs.tabs]);

  // The active tab's repository, when it is not the open one. Its pane
  // cannot be rendered from here — every query and every host call is
  // scoped to the open repo — so the notice stands in until the repo
  // switch that activating it kicked off lands.
  const activePane = paneTabs.find((t) => t.id === paneActiveId);
  const foreignCwd = activePane ? foreignRepoOf(activePane, repo.cwd) : null;

  // Mount policy: the active tab plus any tab whose branch has a PTY
  // session (its terminal must stay mounted to keep scrollback). Other
  // panes unmount while inactive — a diff pane can hold tens of
  // thousands of nodes, and keeping several alive made every
  // interaction (typing, closing tabs) pay for all of them.
  const hasSession = (tab: Tab): boolean => sessionNameFor(tab) != null;

  if (tabs.tabs.length === 0) {
    return (
      <EmptyState onOpenPalette={onOpenPalette} hasItems={items.length > 0} />
    );
  }

  const confirmDialog = closer.confirmDialog;

  return (
    <div className="flex h-full min-w-0 flex-col bg-background">
      <div className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-border bg-tab [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.tabs.map((tab, i) => {
          const sessionName = sessionNameFor(tab);
          return (
            <TabButton
              key={tab.id}
              tab={tab}
              item={itemFor(tab)}
              active={tab.id === tabs.activeId}
              closer={closer}
              snapshot={sessionName ? activity.data?.[sessionName] : undefined}
              foreignRepo={foreignRepoOf(tab, repo.cwd)}
              startsGroup={groupStarts[i]}
              running={tab.kind === 'terminal' && terminalRunning.has(tab.name)}
            />
          );
        })}
        <div className="flex-1" />
      </div>
      <div className="relative min-h-0 flex-1" data-editor-panes>
        {paneTabs.map((tab) => {
          // A foreign tab has no pane here: its data lives in a
          // repository this window is not pointing at.
          if (foreignRepoOf(tab, repo.cwd) !== null) return null;
          const active = tab.id === paneActiveId;
          if (!active && !hasSession(tab)) return null;
          return (
            <div
              key={tab.id}
              aria-hidden={!active}
              className={cn(
                'absolute inset-0 flex min-h-0 flex-col',
                !active && 'invisible'
              )}
            >
              <ErrorBoundary resetKey={tab.id}>
                {/* The pane bodies are code-split (see lazy-panes), but
                    none suspends — each renders its own placeholder
                    until its module lands, so there is no Suspense
                    boundary here to throttle the swap. */}
                <PaneBody
                  tab={tab}
                  item={itemFor(tab)}
                  items={items}
                  active={active}
                  onPin={() => tabs.pin(tab.id)}
                />
              </ErrorBoundary>
            </div>
          );
        })}
        {foreignCwd && (
          <div className="absolute inset-0 flex min-h-0 flex-col">
            <ForeignRepoPane cwd={foreignCwd} />
          </div>
        )}
        {paneActiveId === null && (
          // Tabs on the strip, but none of them this repository's — it
          // was just opened and has nothing of its own open yet.
          <div className="absolute inset-0 flex min-h-0 flex-col">
            <EmptyState
              onOpenPalette={onOpenPalette}
              hasItems={items.length > 0}
            />
          </div>
        )}
      </div>
      {confirmDialog}
    </div>
  );
}
