import {
  ChevronRightIcon,
  PanelLeftCloseIcon,
  PlusIcon,
  RefreshCwIcon,
} from 'lucide-react';
import { useFleet } from '../../lib/machines/fleet-context.js';
import { useState } from 'react';
import type { SidebarItem } from '../../../host/contract.js';
import { useRepo } from '../../lib/repo-context.js';
import { useRefreshRemote } from '../../lib/data/mutations.js';
import {
  groupSections,
  itemKey,
  type SectionKey,
} from '../../lib/sidebar/sidebar-model.js';
import { useRepoTabs } from '../../lib/tabs/tabs.js';
import { basename, cn } from '../../lib/utils.js';
import { Button } from '../ui/button.js';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../ui/collapsible.js';
import { ScrollArea } from '../ui/scroll-area.js';
import { Skeleton } from '../ui/skeleton.js';
import { Tip } from '../ui/tooltip.js';
import { SidebarRow } from './SidebarRow.js';

/**
 * Explorer-style sidebar: the TUI's unified list (worktrees → PRs →
 * review buckets) as collapsible sections. Single-click previews an
 * item in the editor area, double-click pins it.
 */
export function Sidebar({
  items,
  loading,
  updatedAt,
  error,
  onNewWorktree,
  onCollapse,
}: {
  items: SidebarItem[];
  loading: boolean;
  /** When the rows last came back from the host — for a test to tell a
   *  poll that landed from one that has not, since a poll answered
   *  about another repository changes nothing else on screen. */
  updatedAt?: number;
  error: string | null;
  onNewWorktree: () => void;
  onCollapse: () => void;
}) {
  const { repo } = useRepo();
  const fleet = useFleet();
  const tabs = useRepoTabs();
  const refresh = useRefreshRemote(repo.cwd);
  const sections = groupSections(items);
  const [collapsed, setCollapsed] = useState<
    Partial<Record<SectionKey, boolean>>
  >({});

  // Only this repository's active tab highlights a row here. Another
  // repo's tab can be the active one (the strip spans repos), and its
  // key would light up a same-named row that has nothing to do with it.
  const activeItemKey = (() => {
    const t = tabs.tabs.find((x) => x.id === tabs.activeId);
    return t?.kind === 'item' && t.repo === repo.cwd ? t.itemKey : null;
  })();

  return (
    <aside
      className="flex h-full min-w-0 flex-col bg-sidebar text-sidebar-foreground"
      data-updated-at={updatedAt}
    >
      <div className="flex h-9 shrink-0 items-center justify-between pr-1 pl-3">
        <span className="truncate text-base font-semibold">
          {basename(repo.cwd)}
        </span>
        <div className="flex items-center">
          <Tip label="New worktree / check out branch">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onNewWorktree}
              aria-label="New worktree"
            >
              <PlusIcon />
            </Button>
          </Tip>
          <Tip label="Refresh pull requests">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => refresh.mutate()}
              aria-label="Refresh"
            >
              <RefreshCwIcon
                className={cn(refresh.isPending && 'animate-spin')}
              />
            </Button>
          </Tip>
          <Tip label="Hide sidebar (Ctrl B)">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onCollapse}
              aria-label="Hide sidebar"
            >
              <PanelLeftCloseIcon />
            </Button>
          </Tip>
        </div>
      </div>

      <Button
        variant="ghost"
        className="mx-2 mb-2 justify-start"
        onClick={fleet.show}
      >
        Fleet
      </Button>
      <ScrollArea className="min-h-0 flex-1">
        {loading && items.length === 0 && (
          <div className="space-y-2 px-3 py-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-5/6" />
            <Skeleton className="h-6 w-4/6" />
          </div>
        )}
        {!loading && items.length === 0 && !error && (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            <p>No worktrees or pull requests yet.</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={onNewWorktree}
            >
              <PlusIcon /> New worktree
            </Button>
          </div>
        )}
        {sections.map((section) => {
          const isOpen = !collapsed[section.key];
          return (
            <Collapsible
              key={section.key}
              open={isOpen}
              onOpenChange={(o) =>
                setCollapsed((c) => ({ ...c, [section.key]: !o }))
              }
            >
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="flex h-[22px] w-full items-center gap-1 px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
                >
                  <ChevronRightIcon
                    className={cn(
                      'size-3.5 transition-transform',
                      isOpen && 'rotate-90'
                    )}
                  />
                  <span className="truncate">{section.label}</span>
                  <span className="ml-auto mr-1 rounded-full bg-muted px-1.5 text-[10px] font-medium tabular-nums text-muted-foreground">
                    {section.items.length}
                  </span>
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                {section.items.map((item) => (
                  <SidebarRow
                    key={itemKey(item)}
                    item={item}
                    active={itemKey(item) === activeItemKey}
                    onOpen={(preview) =>
                      tabs.openItem(itemKey(item), { preview })
                    }
                  />
                ))}
              </CollapsibleContent>
            </Collapsible>
          );
        })}
      </ScrollArea>

      {error && (
        <div className="border-t border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}
    </aside>
  );
}
