import {
  BookOpenIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
} from 'lucide-react';
import type { ReviewComment } from '../../../host/contract.js';
import { cn } from '../../lib/utils.js';
import { Button } from '../ui/button.js';
import { ScrollArea } from '../ui/scroll-area.js';
import { Tip } from '../ui/tooltip.js';
import { CommentsList, type CommentListItem } from './comments/CommentsList.js';
import { FileTree, type FileEntry } from './diff/FileTree.js';
import {
  AgentSection,
  PlanSection,
  ReviewReadySection,
} from './ReviewRailSections.js';

/** What is left of the rail while it is hidden: the button back. */
export function CollapsedRail({ onShow }: { onShow: () => void }) {
  return (
    <div className="flex w-9 shrink-0 flex-col items-center border-r border-border bg-sidebar pt-1">
      <Tip label="Show review sidebar" side="right">
        <Button
          variant="ghost"
          size="icon"
          onClick={onShow}
          aria-label="Show review sidebar"
        >
          <PanelLeftOpenIcon />
        </Button>
      </Tip>
    </div>
  );
}

export function ReviewRail({
  hasPr,
  overviewActive,
  onOverview,
  running,
  busy,
  hasSession,
  agentActive,
  onSelectAgent,
  onLaunch,
  onStop,
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
  commentsOpen,
  onCommentsOpenChange,
  onJumpComment,
  onCommentContextMenu,
}: {
  hasPr: boolean;
  overviewActive: boolean;
  onOverview: () => void;
  running: boolean;
  busy: boolean;
  hasSession: boolean;
  agentActive: boolean;
  onSelectAgent: () => void;
  onLaunch: () => void;
  onStop: () => void;
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
  commentsOpen: boolean;
  onCommentsOpenChange: (open: boolean) => void;
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

      {/* Agent — a running row you can select to view the terminal, or
          a launch button (opening the session/review menu) otherwise. */}
      <div className="shrink-0 border-b border-border px-2 pb-2">
        <AgentSection
          running={running}
          busy={busy}
          hasSession={hasSession}
          agentActive={agentActive}
          onSelectAgent={onSelectAgent}
          onLaunch={onLaunch}
          onStop={onStop}
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
          open={commentsOpen}
          onOpenChange={onCommentsOpenChange}
          onJump={onJumpComment}
          onContextMenu={onCommentContextMenu}
        />
      </ScrollArea>
    </div>
  );
}
