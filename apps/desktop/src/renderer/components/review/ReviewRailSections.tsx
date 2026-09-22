import {
  BotIcon,
  ClipboardCheckIcon,
  ClipboardListIcon,
  Loader2Icon,
  PlayIcon,
  SendIcon,
  SquareIcon,
  TerminalIcon,
} from 'lucide-react';
import type { ReviewComment } from '../../../host/contract.js';
import type { WorktreeSession } from '../../lib/review/worktree-sessions.js';
import { severityCounts } from '../../lib/diff/diff-model.js';
import { formatSeverityBreakdown } from '../../lib/review/severity.js';
import { cn } from '../../lib/utils.js';
import { Button } from '../ui/button.js';
import { Tip } from '../ui/tooltip.js';

/**
 * The stacked entries at the top of the review rail. Each is its own
 * component because each appears on its own condition — there is no
 * order or state shared between them, only a column.
 */

/**
 * Every live session of this worktree, as rows you switch between.
 *
 * A worktree can hold several at once — the agent on the branch, a
 * reviewer beside it, a shell for ad-hoc work — and this is where the
 * user moves between them: each row selects that session into the
 * content pane. The branch agent keeps Stop beside it, because it is
 * the only one this rail is responsible for ending; a terminal is
 * closed from its own tab like any other.
 *
 * With nothing running the list has nothing to show, so the section is
 * just the two buttons that start something.
 */
export function SessionsSection({
  sessions,
  selected,
  busy,
  hasSession,
  onSelect,
  onLaunch,
  onStop,
  onOpenTerminal,
}: {
  sessions: WorktreeSession[];
  /** Registry key of the session showing in the pane, if any. */
  selected: string | null;
  busy: boolean;
  hasSession: boolean;
  onSelect: (session: WorktreeSession) => void;
  onLaunch: () => void;
  onStop: () => void;
  /** Absent when the branch has no worktree yet — there is nowhere to
   *  open a shell. */
  onOpenTerminal?: () => void;
}) {
  const branchAgentRunning = sessions.some(
    (session) => session.isBranchAgent && session.running
  );
  return (
    <div className="space-y-1">
      {sessions.length > 0 && (
        <ul className="space-y-0.5">
          {sessions.map((session) => (
            <li key={session.name}>
              <SessionRow
                session={session}
                active={session.name === selected}
                onSelect={() => onSelect(session)}
                onStop={session.isBranchAgent ? onStop : undefined}
              />
            </li>
          ))}
        </ul>
      )}
      {!branchAgentRunning && (
        <Button className="w-full" size="sm" onClick={onLaunch} disabled={busy}>
          <PlayIcon />{' '}
          {busy ? 'Working…' : hasSession ? 'Relaunch agent' : 'Launch agent'}
        </Button>
      )}
      <OpenTerminalButton onOpenTerminal={onOpenTerminal} />
    </div>
  );
}

function OpenTerminalButton({
  onOpenTerminal,
}: {
  onOpenTerminal?: () => void;
}) {
  if (!onOpenTerminal) return null;
  return (
    <Button
      variant="outline"
      size="sm"
      className="w-full"
      onClick={onOpenTerminal}
    >
      <TerminalIcon /> Open terminal
    </Button>
  );
}

const SESSION_ICON: Record<WorktreeSession['kind'], typeof BotIcon> = {
  agent: BotIcon,
  review: ClipboardCheckIcon,
  shell: TerminalIcon,
};

/**
 * One session. The live dot is the whole status: a session that has
 * exited keeps its row — its pane still holds the transcript — and
 * says so rather than disappearing.
 */
function SessionRow({
  session,
  active,
  onSelect,
  onStop,
}: {
  session: WorktreeSession;
  active: boolean;
  onSelect: () => void;
  onStop?: () => void;
}) {
  const Icon = SESSION_ICON[session.kind];
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={onSelect}
        aria-current={active}
        className={cn(
          'flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-base transition-colors',
          active
            ? 'bg-sidebar-active text-foreground'
            : 'hover:bg-sidebar-accent'
        )}
      >
        <span className="relative flex size-4 shrink-0 items-center justify-center">
          <Icon className="size-4 text-muted-foreground" />
          {session.running && (
            <span className="absolute -right-0.5 -bottom-0.5 flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60" />
              <span className="relative inline-flex size-2 rounded-full bg-success ring-2 ring-sidebar" />
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1 truncate text-left">
          {session.label}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {session.running ? 'running' : 'exited'}
        </span>
      </button>
      {onStop && session.running && (
        <Tip label="Stop agent">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onStop}
            aria-label="Stop agent"
          >
            <SquareIcon />
          </Button>
        </Tip>
      )}
    </div>
  );
}

/** The way in to the draft walkthrough, plus a post-everything escape. */
export function ReviewReadySection({
  drafts,
  reviewActive,
  onReview,
  postingAll,
  onPostAll,
}: {
  drafts: ReviewComment[];
  reviewActive: boolean;
  onReview: () => void;
  postingAll: boolean;
  onPostAll: () => void;
}) {
  if (drafts.length === 0) return null;
  return (
    <div className="shrink-0 border-b border-border px-2 py-2">
      <button
        type="button"
        onClick={onReview}
        className={cn(
          'flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left transition-colors',
          reviewActive
            ? 'border-primary bg-primary/10'
            : 'border-border hover:bg-sidebar-accent'
        )}
      >
        <ClipboardCheckIcon className="size-4 shrink-0 text-primary" />
        <span className="min-w-0 flex-1">
          <span className="block text-base font-medium">Review ready</span>
          <span className="block text-xs text-muted-foreground">
            {formatSeverityBreakdown(severityCounts(drafts))}
          </span>
        </span>
        <span className="shrink-0 rounded-full bg-primary px-1.5 text-xs font-medium text-primary-foreground tabular-nums">
          {drafts.length}
        </span>
      </button>
      <Button
        variant="outline"
        size="sm"
        className="mt-2 w-full"
        onClick={onPostAll}
        disabled={postingAll}
      >
        {postingAll ? <Loader2Icon className="animate-spin" /> : <SendIcon />}
        Post all {drafts.length} draft{drafts.length === 1 ? '' : 's'}
      </Button>
    </div>
  );
}

/**
 * The comments queued for the agent. Hidden at zero, like "Review
 * ready" above it: an empty cart is not a thing to look at.
 */
export function PlanSection({
  planCount,
  planNoted,
  planActive,
  onPlan,
}: {
  planCount: number;
  planNoted: number;
  planActive: boolean;
  onPlan: () => void;
}) {
  if (planCount === 0) return null;
  return (
    <div className="shrink-0 border-b border-border px-2 py-2">
      <button
        type="button"
        onClick={onPlan}
        className={cn(
          'flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left transition-colors',
          planActive
            ? 'border-primary bg-primary/10'
            : 'border-border hover:bg-sidebar-accent'
        )}
      >
        <ClipboardListIcon className="size-4 shrink-0 text-primary" />
        <span className="min-w-0 flex-1">
          <span className="block text-base font-medium">Plan</span>
          <span className="block text-xs text-muted-foreground">
            {planCount} comment{planCount === 1 ? '' : 's'}
            {planNoted > 0 && ` · ${planNoted} with a note`}
          </span>
        </span>
        <span className="shrink-0 rounded-full bg-primary px-1.5 text-xs font-medium text-primary-foreground tabular-nums">
          {planCount}
        </span>
      </button>
    </div>
  );
}
