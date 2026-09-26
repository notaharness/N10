import {
  GitBranchIcon,
  GitPullRequestIcon,
  SettingsIcon,
  TerminalIcon,
  XIcon,
} from 'lucide-react';
import type {
  ContextMenuItem,
  SessionActivitySnapshot,
  SidebarItem,
} from '../../../host/contract.js';
import { usePlanCount } from '../../lib/plan/plan.js';
import { itemRunning } from '../../lib/sidebar/sidebar-model.js';
import {
  repoDisplayName,
  tabPresentation,
  type TabFace,
} from '../../lib/tabs/tab-presentation.js';
import { useTabs, type Tab } from '../../lib/tabs/tabs.js';
import type { useCloseTabs } from '../../lib/tabs/use-close-tabs.js';
import { cn } from '../../lib/utils.js';
import { pressWithoutFocus } from './tab-keyboard.js';
import { useSortableTab } from './TabStrip.js';

type Closer = ReturnType<typeof useCloseTabs>;

/** The tab's kind icon, with the agent's state hung off its corner. */
function TabIcon({
  Icon,
  running,
  snapshot,
}: {
  Icon: typeof SettingsIcon;
  running: boolean;
  snapshot: SessionActivitySnapshot | undefined;
}) {
  return (
    <span className="relative flex shrink-0">
      <Icon className="size-4" />
      {snapshot?.active ? (
        <span className="absolute -right-1 -bottom-1 flex items-center justify-center rounded-full bg-tab-active p-0.5">
          <span className="agent-spinner size-2.5 rounded-full" />
        </span>
      ) : running ? (
        <span className="absolute -right-0.5 -bottom-0.5 size-2 rounded-full bg-success ring-2 ring-tab-active" />
      ) : null}
    </span>
  );
}

const FACE_ICON: Record<TabFace, typeof SettingsIcon> = {
  settings: SettingsIcon,
  pr: GitPullRequestIcon,
  branch: GitBranchIcon,
  terminal: TerminalIcon,
};

/**
 * The tab's title, prefixed with its repository when that is not the
 * open one — the strip spans repos, and `main` alone says nothing about
 * which checkout it is.
 */
function TabLabel({
  label,
  preview,
  foreignRepo,
}: {
  label: string;
  preview: boolean;
  foreignRepo: string | null;
}) {
  return (
    <span className={cn('min-w-0 flex-1 truncate', preview && 'italic')}>
      {foreignRepo && (
        <span className="text-muted-foreground/70">
          {repoDisplayName(foreignRepo)}
          <span className="px-0.5 opacity-60">/</span>
        </span>
      )}
      {label}
    </span>
  );
}

/** How many comments this tab's PR has queued in the plan. */
function PlanCountBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      aria-label={`${count} comment${count === 1 ? '' : 's'} in the plan`}
      className="shrink-0 rounded-full bg-primary/15 px-1.5 text-[10px] font-medium tabular-nums text-primary"
    >
      {count}
    </span>
  );
}

/** A tab that opened in the background and has not been looked at. */
function UnseenDot() {
  return (
    <span
      aria-label="Not yet opened"
      className="size-1.5 shrink-0 rounded-full bg-primary"
    />
  );
}

/** Always rendered; revealed on hover, or while the tab is active.
 *  Out of the Tab order: the row is one Tab stop, and Delete closes
 *  the focused tab. */
function TabCloseButton({
  active,
  onClose,
}: {
  active: boolean;
  onClose: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      tabIndex={-1}
      onClick={onClose}
      aria-label="Close tab"
      className={cn(
        'flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100',
        active && 'opacity-100'
      )}
    >
      <XIcon className="size-3.5" />
    </button>
  );
}

/** The hover title: the full path, for telling two checkouts of the
 *  same repo apart — and a terminal's whole directory, since its label
 *  is cut from the front. */
function tabTitle(tab: Tab, foreignRepo: string | null): string | undefined {
  if (foreignRepo) return foreignRepo;
  return tab.kind === 'terminal' ? tab.cwd : undefined;
}

/** The native context menu a tab offers. */
function tabMenuItems(tab: Tab, tabCount: number): ContextMenuItem[] {
  const items: ContextMenuItem[] = [
    { id: 'close', label: 'Close' },
    { id: 'close-others', label: 'Close Others', enabled: tabCount > 1 },
    { id: 'close-all', label: 'Close All' },
  ];
  if (tab.preview) {
    items.push({ type: 'separator' }, { id: 'pin', label: 'Keep Open' });
  }
  return items;
}

async function runTabMenu(
  tab: Tab,
  tabs: ReturnType<typeof useTabs>,
  closer: Closer
): Promise<void> {
  const chosen = await window.n10.showContextMenu(
    tabMenuItems(tab, tabs.tabs.length)
  );
  if (chosen === 'close') closer.close(tab.id);
  else if (chosen === 'close-others') closer.closeOthers(tab.id);
  else if (chosen === 'close-all') closer.closeAll();
  else if (chosen === 'pin') tabs.pin(tab.id);
}

function tabClassName({
  active,
  unseen,
  dragging,
  flashing,
}: {
  active: boolean;
  unseen: boolean;
  dragging: boolean;
  flashing: boolean;
}): string {
  return cn(
    'group relative flex h-full max-w-56 min-w-28 cursor-default items-center gap-2 border-r border-border pr-1.5 pl-3 text-base transition-colors select-none',
    // Lifted above the tabs it slides over, and opaque across them;
    // the active tab's own background wins below.
    dragging && 'z-10 bg-tab',
    active
      ? 'bg-tab-active text-foreground'
      : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
    unseen && 'text-foreground',
    // The agent finished a work streak and nobody has looked yet.
    flashing && !active && 'tab-attention'
  );
}

export function TabButton({
  tab,
  item,
  active,
  closer,
  snapshot,
  foreignRepo,
  tabStop,
  running = false,
  unseen = false,
  machineLabel,
}: {
  tab: Tab;
  item: SidebarItem | undefined;
  active: boolean;
  closer: Closer;
  snapshot: SessionActivitySnapshot | undefined;
  /** Live state for a tab that has no item to read it from. */
  running?: boolean;
  /** Opened in the background and not activated since. */
  unseen?: boolean;
  /** The other repository this tab belongs to, or null when it is at
   *  home in the open one. */
  foreignRepo: string | null;
  /** The row's one Tab stop: the active tab, or the first one while
   *  none on the row is active. */
  tabStop: boolean;
  /** The tab's machine, resolved by the caller — null for a local tab,
   *  or with only the local machine registered (ux-machines.md §6, D8). */
  machineLabel?: string | null;
}) {
  const tabs = useTabs();
  const { label, face } = tabPresentation(tab, item, machineLabel);
  const Icon = FACE_ICON[face];
  // A plan is built inside a tab and then navigated away from, so the
  // count has to be visible from wherever the user ends up.
  const planCount = usePlanCount(item?.pr?.id);
  const { setNode, props, style, isDragging } = useSortableTab({
    id: tab.id,
    label,
    tabStop,
    actions: {
      activate: () => tabs.activate(tab.id),
      close: () => closer.close(tab.id),
    },
  });

  return (
    <div
      ref={setNode}
      {...props}
      style={style}
      aria-selected={active}
      onMouseDown={(e) => {
        pressWithoutFocus(e);
        if (e.button === 1) {
          e.preventDefault();
          closer.close(tab.id);
        }
      }}
      onClick={() => tabs.activate(tab.id)}
      onDoubleClick={() => tabs.pin(tab.id)}
      onContextMenu={(e) => {
        e.preventDefault();
        void runTabMenu(tab, tabs, closer);
      }}
      title={tabTitle(tab, foreignRepo)}
      data-face={face}
      data-unseen={unseen || undefined}
      className={tabClassName({
        active,
        unseen,
        dragging: isDragging,
        flashing: snapshot?.flashing ?? false,
      })}
    >
      {active && <span className="absolute inset-x-0 top-0 h-px bg-primary" />}
      <TabIcon
        Icon={Icon}
        running={item ? itemRunning(item) : running}
        snapshot={snapshot}
      />
      <TabLabel label={label} preview={tab.preview} foreignRepo={foreignRepo} />
      <PlanCountBadge count={planCount} />
      {unseen && <UnseenDot />}
      <TabCloseButton
        active={active}
        onClose={(e) => {
          e.stopPropagation();
          closer.close(tab.id);
        }}
      />
    </div>
  );
}
