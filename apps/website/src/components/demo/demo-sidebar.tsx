import {
  ChevronDown,
  Circle,
  CircleCheck,
  CircleX,
  GitBranch,
  GitPullRequest,
  MessageSquare,
} from 'lucide-react';
import { ITEMS, SECTIONS, type DemoItem } from '@/components/demo/items';
import type { AgentState, Ci } from '@/components/demo/model';

/**
 * The repository sidebar, laid out like n10 Desktop's: worktrees, pull
 * requests and reviews, each row showing its agent and CI at a glance.
 * Every row is a button that opens (or focuses) the item's tab. What an
 * icon says is repeated as screen-reader text in the row's name.
 */
export interface RowStatus {
  agent?: AgentState;
  ci?: Ci;
  unresolved?: number;
}

const AGENT_TEXT: Record<AgentState, string> = {
  working: 'agent working',
  input: 'agent needs your input',
  idle: 'agent idle',
};

function AgentDot({ agent }: { agent?: AgentState }) {
  if (!agent) return null;
  const tone =
    agent === 'working'
      ? 'bg-[var(--n10-t-ok)] motion-safe:animate-pulse'
      : agent === 'input'
      ? 'bg-[var(--n10-sand)]'
      : 'bg-fd-muted-foreground/60';
  return (
    <span
      className={`ring-fd-card absolute -right-0.5 -bottom-0.5 size-2 rounded-full ring-2 ${tone}`}
    />
  );
}

const CI_ICON: Record<
  Ci,
  { Icon: typeof Circle; text: string; count: string; tone: string }
> = {
  failed: {
    Icon: CircleX,
    text: 'CI failed',
    count: '1/1',
    tone: 'text-[var(--n10-t-err)]',
  },
  running: {
    Icon: Circle,
    text: 'CI running',
    count: '0/1',
    tone: 'text-fd-muted-foreground',
  },
  passed: {
    Icon: CircleCheck,
    text: 'CI passed',
    count: '1/1',
    tone: 'text-[var(--n10-t-ok)]',
  },
};

function Checks({ ci, unresolved }: { ci?: Ci; unresolved?: number }) {
  const check = ci && CI_ICON[ci];
  return (
    <span className="text-fd-muted-foreground flex shrink-0 items-center gap-1.5 text-[11px] tabular-nums">
      {check && (
        <span className={`flex items-center gap-0.5 ${check.tone}`}>
          <check.Icon className="size-3" aria-hidden />
          <span className="sr-only">, checks </span>
          {check.count}
          <span className="sr-only">, {check.text}</span>
        </span>
      )}
      {unresolved ? (
        <span className="flex items-center gap-0.5">
          <MessageSquare className="size-3" aria-hidden />
          <span className="sr-only">, </span>
          {unresolved}
          <span className="sr-only"> unresolved</span>
        </span>
      ) : null}
    </span>
  );
}

function Row({
  item,
  status,
  active,
  onOpen,
}: {
  item: DemoItem;
  status: RowStatus;
  active: boolean;
  onOpen: () => void;
}) {
  const Icon = item.pr ? GitPullRequest : GitBranch;
  const iconTone =
    item.section === 'review' ? 'text-[var(--n10-sand)]' : 'text-fd-primary';
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        aria-current={active ? 'true' : undefined}
        className={`focus-visible:ring-fd-ring flex w-full items-start gap-2 px-3 py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset ${
          active ? 'bg-fd-accent' : 'hover:bg-fd-accent/60'
        }`}
      >
        <span className={`relative mt-0.5 shrink-0 ${iconTone}`}>
          <Icon className="size-3.5" aria-hidden />
          <AgentDot agent={status.agent} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate">{item.title}</span>
          {item.pr && <span className="sr-only">, </span>}
          {item.pr && (
            <span className="text-fd-muted-foreground flex items-center gap-1.5 text-[11px]">
              <span className="truncate">
                #{item.pr.id}{' '}
                {item.section === 'review' ? item.pr.author : item.branch}
              </span>
              {item.babysitting && (
                <span className="bg-fd-primary/15 text-fd-primary rounded px-1 text-[10px]">
                  babysitting
                </span>
              )}
            </span>
          )}
          {status.agent && (
            <span className="sr-only">, {AGENT_TEXT[status.agent]}</span>
          )}
        </span>
        {item.pr && <Checks ci={status.ci} unresolved={status.unresolved} />}
      </button>
    </li>
  );
}

export function DemoSidebar({
  statusOf,
  active,
  onOpen,
}: {
  statusOf: (item: DemoItem) => RowStatus;
  active: string | null;
  onOpen: (id: string) => void;
}) {
  return (
    <nav
      aria-label="atlas: worktrees and pull requests"
      className="bg-fd-card/60 border-fd-border hidden w-56 shrink-0 flex-col overflow-y-auto border-r py-2 text-[13px] md:flex lg:w-60"
    >
      <div className="px-3 pb-2 font-semibold">atlas</div>
      {SECTIONS.map((section) => {
        const items = ITEMS.filter((item) => item.section === section.id);
        return (
          <div key={section.id} className="mb-1">
            <div
              id={`demo-section-${section.id}`}
              className="text-fd-muted-foreground flex items-center gap-1 px-2 py-1 text-[11px] font-semibold tracking-wider uppercase"
            >
              <ChevronDown className="size-3" aria-hidden />
              <span className="flex-1">{section.title}</span>
              <span className="bg-fd-muted rounded-full px-1.5 tabular-nums">
                {items.length}
              </span>
            </div>
            <ul aria-labelledby={`demo-section-${section.id}`}>
              {items.map((item) => (
                <Row
                  key={item.id}
                  item={item}
                  status={statusOf(item)}
                  active={item.id === active}
                  onOpen={() => onOpen(item.id)}
                />
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
