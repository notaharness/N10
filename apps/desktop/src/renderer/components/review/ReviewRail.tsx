import { BookOpenIcon, PanelLeftCloseIcon } from 'lucide-react';
import type { ReviewComment } from '../../../host/contract.js';
import { cn } from '../../lib/utils.js';
import { Button } from '../ui/button.js';
import { ScrollArea } from '../ui/scroll-area.js';
import { Tip } from '../ui/tooltip.js';
import { CommentsList, type CommentListItem } from './comments/CommentsList.js';
import { FileTree, type FileEntry } from './diff/FileTree.js';
import type { WorktreeSession } from '../../lib/review/worktree-sessions.js';
import {
  PlanSection,
  ReviewReadySection,
  SessionsSection,
} from './ReviewRailSections.js';

export function ReviewRail({
  hasPr,
  overviewActive,
  onOverview,
  busy,
  hasSession,
  sessions,
  selectedSession,
  onSelectSession,
  onLaunch,
  onStop,
  onOpenTerminal,
  onHide,
  drafts,
  reviewActive,
  onReview,
  postingAll,
  onPostAll,
  planCount,
  planNoted,
  planActive,
  onPlan,
  entries,
  diffLoading,
  selectedFile,
  onSelectFile,
  commentItems,
  activeCommentId,
  onJumpComment,
  onCommentContextMenu,
}: {
  hasPr: boolean;
  overviewActive: boolean;
  onOverview: () => void;
  busy: boolean;
  hasSession: boolean;
  /** Every live session of this worktree — see `worktree-sessions.ts`. */
  sessions: WorktreeSession[];
  /** Registry key of the one showing in the pane, if any. */
  selectedSession: string | null;
  onSelectSession: (session: WorktreeSession) => void;
  onLaunch: () => void;
  onStop: () => void;
  /** Absent when the branch has no worktree yet. */
  onOpenTerminal?: () => void;
  onHide: () => void;
  drafts: ReviewComment[];
  reviewActive: boolean;
  onReview: () => void;
  postingAll: boolean;
  onPostAll: () => void;
  /** Comments queued for the agent; the entry hides at zero. */
  planCount: number;
  planNoted: number;
  planActive: boolean;
  onPlan: () => void;
  entries: FileEntry[];
  diffLoading: boolean;
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
  commentItems: CommentListItem[];
  activeCommentId: string | null;
  onJumpComment: (item: CommentListItem) => void;
  onCommentContextMenu: (item: CommentListItem) => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-sidebar/60">
      <div className="flex h-8 shrink-0 items-center justify-between pr-1 pl-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Review
        </span>
        <Tip label="Hide review sidebar">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onHide}
            aria-label="Hide review sidebar"
          >
            <PanelLeftCloseIcon />
          </Button>
        </Tip>
      </div>

      {/* Overview — the PR's title, description and verdict actions. */}
      {hasPr && (
        <div className="shrink-0 px-2 pb-1">
          <button
            type="button"
            onClick={onOverview}
            className={cn(
              'flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-2 text-base transition-colors',
              overviewActive
                ? 'bg-sidebar-active text-foreground'
                : 'hover:bg-sidebar-accent'
            )}
          >
            <BookOpenIcon className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-left">Overview</span>
          </button>
        </div>
      )}

      {/* Sessions — the worktree's live sessions, as rows you switch
          between, plus the ways to start another. */}
      <div className="shrink-0 border-b border-border px-2 pb-2">
        <SessionsSection
          sessions={sessions}
          selected={selectedSession}
          busy={busy}
          hasSession={hasSession}
          onSelect={onSelectSession}
          onLaunch={onLaunch}
          onStop={onStop}
          onOpenTerminal={onOpenTerminal}
        />
      </div>

      <ReviewReadySection
        drafts={drafts}
        reviewActive={reviewActive}
        onReview={onReview}
        postingAll={postingAll}
        onPostAll={onPostAll}
      />

      <PlanSection
        planCount={planCount}
        planNoted={planNoted}
        planActive={planActive}
        onPlan={onPlan}
      />

      {/* Files + Comments */}
      <ScrollArea className="min-h-0 flex-1">
        <FileTree
          entries={entries}
          loading={diffLoading}
          selected={selectedFile}
          onSelect={onSelectFile}
        />
        <CommentsList
          items={commentItems}
          activeId={activeCommentId}
          onJump={onJumpComment}
          onContextMenu={onCommentContextMenu}
        />
      </ScrollArea>
    </div>
  );
}
