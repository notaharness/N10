import type { DiffLine } from '@n10/diff';
import type { PullRequestInfo } from '@n10/vcs-core';
import type { ReactNode, Ref, RefObject } from 'react';
import type {
  RemoteCommentThread,
  ReviewComment,
} from '../../../host/contract.js';
import type { PlanItem } from '@n10/core/plan';
import { type Mode } from '../../lib/review/review-model.js';
import { cn } from '../../lib/utils.js';
import { SessionTerminal } from '../terminal/SessionTerminal.js';
import { DiffPane } from './diff/DiffPane.js';
import { type DiffJumpHandle } from './diff/VirtualDiffList.js';
import { OverviewPane } from './OverviewPane.js';
import { PlanPane } from './PlanPane.js';
import { ReviewStepper } from './drafts/ReviewStepper.js';

/**
 * One layer of the stack. Hidden rather than unmounted, so a pane's
 * scroll position — and a terminal's scrollback — survives a trip to
 * another mode and back.
 */
function StackedPane({
  visible,
  children,
}: {
  visible: boolean;
  children: ReactNode;
}) {
  return (
    <div className={cn('absolute inset-0', !visible && 'invisible')}>
      {children}
    </div>
  );
}

/**
 * The single content pane, with every mode's view stacked in it. The
 * terminal and the walkthrough stay mounted and are hidden rather than
 * unmounted, so switching modes never costs their scrollback or their
 * scroll position.
 */
export function ContentPane({
  effMode,
  pr,
  prId,
  branch,
  baseBranch,
  sessionName,
  sessionEpoch,
  active,
  files,
  filesByName,
  fileOrder,
  threadsByFile,
  draftsByFile,
  general,
  hideResolved,
  drafts,
  hasDrafts,
  commentsLoading,
  diffPending,
  diffError,
  focusThreadId,
  scrollRef,
  jumpRef,
  navCount,
  navIndex,
  onPrev,
  onNext,
  onExitReview,
  onOpenInDiff,
  plan,
}: {
  effMode: Mode;
  pr?: PullRequestInfo;
  prId: number;
  branch: string;
  baseBranch: string;
  sessionName?: string;
  /** Changes when a new agent is spawned into this pane — see
   *  `SessionTerminal`, which re-fits its grid on it. */
  sessionEpoch: number;
  active: boolean;
  files: [string, DiffLine[]][];
  filesByName: Map<string, DiffLine[]>;
  fileOrder: Map<string, number>;
  threadsByFile: Map<string, RemoteCommentThread[]>;
  draftsByFile: Map<string, ReviewComment[]>;
  general: RemoteCommentThread[];
  hideResolved: boolean;
  drafts: ReviewComment[];
  hasDrafts: boolean;
  commentsLoading: boolean;
  diffPending: boolean;
  diffError: Error | null;
  focusThreadId: string | null;
  scrollRef: RefObject<HTMLDivElement | null>;
  jumpRef: Ref<DiffJumpHandle>;
  navCount: number;
  navIndex: number;
  onPrev: () => void;
  onNext: () => void;
  onExitReview: () => void;
  onOpenInDiff: (file: string) => void;
  /** Everything the plan pane needs; absent on a bare worktree tab. */
  plan?: {
    items: PlanItem[];
    agentRunning: boolean;
    sending: boolean;
    onRemove: (item: PlanItem) => void;
    onAnnotate: (item: PlanItem, note: string) => void;
    onShowInDiff: (item: PlanItem) => void;
    onClear: () => void;
    onSend: (mode: 'inject' | 'new-session') => void;
    openNoteFor: { key: string } | null;
  };
}) {
  const headSha = pr?.headSha;
  const generalThreads = hideResolved
    ? general.filter((t) => !t.isResolved)
    : general;
  return (
    <div data-terminal-pane className="relative h-full min-h-0">
      {sessionName && (
        <StackedPane visible={effMode === 'agent'}>
          <SessionTerminal
            name={sessionName}
            epoch={sessionEpoch}
            active={active && effMode === 'agent'}
          />
        </StackedPane>
      )}
      {hasDrafts && (
        <StackedPane visible={effMode === 'review'}>
          {effMode === 'review' && (
            <ReviewStepper
              prId={prId}
              headSha={headSha}
              drafts={drafts}
              filesByName={filesByName}
              fileOrder={fileOrder}
              active={active}
              onExit={onExitReview}
              onOpenInDiff={onOpenInDiff}
            />
          )}
        </StackedPane>
      )}
      {plan && effMode === 'plan' && (
        <div className="absolute inset-0">
          <PlanPane
            items={plan.items}
            branch={branch}
            agentRunning={plan.agentRunning}
            sending={plan.sending}
            onRemove={plan.onRemove}
            onAnnotate={plan.onAnnotate}
            onShowInDiff={plan.onShowInDiff}
            onClear={plan.onClear}
            onSend={plan.onSend}
            openNoteFor={plan.openNoteFor}
          />
        </div>
      )}
      {pr && effMode === 'overview' && (
        <div className="absolute inset-0">
          <OverviewPane pr={pr} />
        </div>
      )}
      <StackedPane visible={effMode === 'diff'}>
        <DiffPane
          prId={prId}
          headSha={headSha}
          sourceBranch={branch}
          targetBranch={baseBranch}
          files={files}
          threadsByFile={threadsByFile}
          draftsByFile={draftsByFile}
          generalThreads={generalThreads}
          commentsLoading={commentsLoading}
          diffLoading={diffPending}
          diffError={diffError ? String(diffError.message) : null}
          focusThreadId={focusThreadId}
          scrollRef={scrollRef}
          jumpRef={jumpRef}
          navCount={navCount}
          navIndex={navIndex}
          onPrev={onPrev}
          onNext={onNext}
        />
      </StackedPane>
    </div>
  );
}
