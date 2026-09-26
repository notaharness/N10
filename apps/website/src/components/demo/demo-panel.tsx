import {
  Circle,
  CircleCheck,
  CircleX,
  GitBranch,
  GitPullRequest,
  MessageSquare,
} from 'lucide-react';
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import type { DemoItem } from '@/components/demo/items';
import type { Ci } from '@/components/demo/model';

/**
 * A tab's content: the item's header strip, as n10 Desktop draws it
 * over a worktree or pull request, and the terminal below it. The
 * terminal follows new output unless the viewer has scrolled up.
 */
const CI_BADGE: Record<
  Ci,
  { Icon: typeof Circle; text: string; tone: string }
> = {
  failed: { Icon: CircleX, text: 'CI failed', tone: 'text-[var(--n10-t-err)]' },
  running: {
    Icon: Circle,
    text: 'CI running',
    tone: 'text-fd-muted-foreground',
  },
  passed: {
    Icon: CircleCheck,
    text: 'CI succeeded',
    tone: 'text-[var(--n10-t-ok)]',
  },
};

export function PanelHeader({
  item,
  ci,
  unresolved,
}: {
  item: DemoItem;
  ci?: Ci;
  unresolved?: number;
}) {
  const badge = ci && CI_BADGE[ci];
  return (
    <div className="border-fd-border flex h-9 shrink-0 items-center gap-3 overflow-hidden border-b px-3 text-[13px] whitespace-nowrap">
      {item.pr ? (
        <GitPullRequest
          className="text-fd-primary size-3.5 shrink-0"
          aria-hidden
        />
      ) : (
        <GitBranch
          className="text-fd-muted-foreground size-3.5 shrink-0"
          aria-hidden
        />
      )}
      <span className="min-w-0 truncate font-medium">
        {item.pr?.title ?? item.branch}
      </span>
      {item.pr && (
        <span className="text-fd-muted-foreground">#{item.pr.id}</span>
      )}
      <span className="text-fd-muted-foreground hidden font-mono text-xs lg:inline">
        {item.pr ? `${item.branch} → main` : 'diff vs main'}
      </span>
      {badge && (
        <span className={`flex items-center gap-1 text-xs ${badge.tone}`}>
          <badge.Icon className="size-3.5" aria-hidden />
          {badge.text}
        </span>
      )}
      {item.pr && unresolved !== undefined && (
        <span className="text-fd-muted-foreground hidden items-center gap-1 text-xs sm:flex">
          <MessageSquare className="size-3.5" aria-hidden />
          {unresolved} unresolved
        </span>
      )}
    </div>
  );
}

export function TerminalScreen({
  label,
  version,
  onClick,
  children,
}: {
  label: string;
  /** Changes whenever output is added, to follow it. */
  version: string;
  onClick?: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  useLayoutEffect(() => {
    const node = ref.current;
    if (node && follow.current) node.scrollTop = node.scrollHeight;
  }, [version]);
  return (
    // The click only forwards focus to the shell's input, which is
    // reachable on its own; the region is focusable to scroll by keys.
    <div
      ref={ref}
      role="region"
      aria-label={label}
      tabIndex={0}
      onClick={onClick}
      onScroll={() => {
        const node = ref.current;
        if (!node) return;
        follow.current =
          node.scrollHeight - node.scrollTop - node.clientHeight < 24;
      }}
      className="n10-term focus-visible:ring-fd-ring min-h-0 flex-1 overflow-y-auto px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-inset"
    >
      {children}
    </div>
  );
}
