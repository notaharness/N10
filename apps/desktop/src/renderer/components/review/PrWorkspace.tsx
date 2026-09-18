import { PanelLeftOpenIcon } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Group,
  Panel,
  Separator as PanelSeparator,
} from 'react-resizable-panels';
import { toast } from 'sonner';
import { type DiffLine } from '@n10/diff';
import type { PlanItem } from '@n10/core/plan';
import type { PullRequestInfo } from '@n10/vcs-core';
import { useDiffOptions } from '../../lib/diff/diff-options.js';
import {
  useDiff,
  useDraftComments,
  useParsedDiff,
  useThreads,
  useWorktreeDiff,
} from '../../lib/data/queries.js';
import { usePostDrafts } from '../../lib/data/mutations.js';
import { useRepo } from '../../lib/repo-context.js';
import { useCommentNavigator } from '../../lib/review/use-comment-navigator.js';
import { usePlanCheckout } from '../../lib/plan/use-plan-checkout.js';
import {
  buildFileEntries,
  diffIsPending,
  groupDraftsByFile,
  groupThreadsByFile,
  resolveMode,
  unpostedDrafts,
  type Mode,
} from '../../lib/review/review-model.js';
import { errorMessage } from '../../lib/utils.js';
import { Button } from '../ui/button.js';
import { Tip } from '../ui/tooltip.js';
import { ContentPane } from './ContentPane.js';
import { type FileEntry } from './diff/FileTree.js';
import { BranchHeader, PrHeader } from './PrHeader.js';
import { ReviewRail } from './ReviewRail.js';

/** Shared empty parse, so "no files yet" keeps a stable identity and
 *  the derived lists below are not rebuilt on every render. */
const NO_FILES: [string, DiffLine[]][] = [];

/**
 * The review workspace for a PR: a persistent left rail (Agent · Files
 * · Comments) beside a single content pane that swaps between the diff
 * and the agent terminal. Selecting a file/comment shows the diff;
 * selecting the agent shows its terminal (which stays mounted so its
 * scrollback survives). The diff's own toolbar lives inside the diff
 * pane, so it's gone while the terminal is showing.
 *
 * What to show is decided in `lib/review-model.ts`; this component
 * wires that to the queries, the refs and the markup.
 */
/**
 * The terminal takes over the pane whenever an agent starts, and
 * whenever the user comes back to a tab that already has one running —
 * the agent is what they returned for, not the diff.
 *
 * Written as state adjusted during render (React's own pattern for
 * "derive from a prop change") rather than an effect, so the pane never
 * paints the diff for one frame before switching.
 */
function useAgentFocus(
  running: boolean,
  active: boolean,
  onFocusAgent: () => void
): void {
  const [prevRunning, setPrevRunning] = useState(running);
  if (running !== prevRunning) {
    setPrevRunning(running);
    if (running) onFocusAgent();
  }
  const [prevActive, setPrevActive] = useState(active);
  if (active !== prevActive) {
    setPrevActive(active);
    if (active && running) onFocusAgent();
  }
}

/** What the agent pane's connection banner needs (ux-machines.md §6),
 *  resolved by the caller (ItemView) so PrWorkspace stays free of the
 *  machines query and the reconnect mutation. */
export interface PrConnectionBanner {
  state: 'reconnecting' | 'failed';
  machineLabel: string;
  onReconnect: () => void;
  reconnecting: boolean;
}

export function PrWorkspace({
  pr,
  branch,
  baseBranch,
  sessionName,
  sessionEpoch,
  running,
  active,
  busy,
  onLaunch,
  onStop,
  connectionBanner,
  inputDisabled,
}: {
  /** Absent for a worktree without a PR: the rail degrades gracefully
   *  (no comments, drafts or review walkthrough — just Agent + Files). */
  pr?: PullRequestInfo;
  branch: string;
  baseBranch: string;
  /** PTY session for this branch, if one exists (running or its final frame). */
  sessionName?: string;
  /** When that session was spawned. A restart in the same pane keeps
   *  the name and changes this, which is what tells the terminal a new
   *  agent is on the other end of it. */
  sessionEpoch: number;
  running: boolean;
  active: boolean;
  busy: boolean;
  onLaunch: () => void;
  onStop: () => void;
  /** Set only while the session's connection is reconnecting/failed
   *  (ux-machines.md §6) — the headline capability of this feature runs
   *  here, so a silent dead connection does the most damage in exactly
   *  this pane. */
  connectionBanner?: PrConnectionBanner | null;
  inputDisabled?: boolean;
}) {
  const { repo } = useRepo();
  const prId = pr?.id ?? 0;
  // A pull request is reviewed against its commits — that is what the
  // comment threads anchor to. A worktree without one has nothing to
  // anchor, so it shows the working tree instead and follows the agent
  // as it edits, which is the whole reason to have the pane open while
  // one is running.
  const isWorktreeOnly = pr == null;
  const commitDiff = useDiff(repo.cwd, branch, baseBranch, {
    enabled: !isWorktreeOnly,
  });
  const workingDiff = useWorktreeDiff(repo.cwd, branch, baseBranch, {
    enabled: isWorktreeOnly,
    live: running,
  });
  const diff = isWorktreeOnly ? workingDiff : commitDiff;
  const comments = useThreads(repo.cwd, prId);
  const draftsQuery = useDraftComments(repo.cwd, prId);
  const postAll = usePostDrafts(repo.cwd);
  const options = useDiffOptions();
  const rootRef = useRef<HTMLDivElement>(null);

  const [mode, setMode] = useState<Mode>(running ? 'agent' : 'diff');
  const [railHidden, setRailHidden] = useState(false);

  useAgentFocus(running, active, () => setMode('agent'));
  // Whole-file diffs can be megabytes; the parse runs in the diff
  // worker so opening a tab never blocks the UI thread on it. The query
  // is keyed on the patch content, so what it hands back always belongs
  // to the text on screen — while a newer patch is parsing there is no
  // data for its key and the viewer shows no files, never the old ones.
  const parsed = useParsedDiff(diff.data);
  const files = parsed.data ?? NO_FILES;
  const diffPending = diffIsPending(diff.isLoading, diff.data, parsed.data);
  const inlineThreads = useMemo(
    () => comments.data?.threads ?? [],
    [comments.data]
  );
  const general = useMemo(
    () => comments.data?.generalComments ?? [],
    [comments.data]
  );
  const drafts = useMemo(
    () => unpostedDrafts(draftsQuery.data ?? []),
    [draftsQuery.data]
  );
  const draftsByFile = useMemo(() => groupDraftsByFile(drafts), [drafts]);
  const threadsByFile = useMemo(
    () => groupThreadsByFile(inlineThreads),
    [inlineThreads]
  );

  const fileOrder = useMemo(
    () => new Map(files.map(([f], i) => [f, i])),
    [files]
  );
  const filesByName = useMemo(() => new Map(files), [files]);

  const hasDrafts = drafts.length > 0;

  const entries = useMemo<FileEntry[]>(
    () => buildFileEntries(files, threadsByFile, draftsByFile),
    [files, threadsByFile, draftsByFile]
  );

  const showDiff = useCallback(() => setMode('diff'), []);
  const nav = useCommentNavigator({
    files,
    general,
    inlineThreads,
    drafts,
    hideResolved: options.hideResolved,
    onShowDiff: showDiff,
  });

  // ── The plan ───────────────────────────────────────────────────
  const showPlanItemInDiff = useCallback(
    (item: PlanItem) => nav.jumpToId(item.id, item.file),
    [nav]
  );
  const backToAgent = useCallback(() => setMode('agent'), []);
  const openPlanPane = useCallback(() => setMode('plan'), []);
  // Both comment sources the rail can offer, as one list to resolve an
  // id against.
  const allThreads = useMemo(
    () => [...inlineThreads, ...general],
    [inlineThreads, general]
  );
  const plan = usePlanCheckout({
    cwd: repo.cwd,
    pr,
    running,
    paneRef: rootRef,
    threads: allThreads,
    drafts,
    onSent: backToAgent,
    onShowInDiff: showPlanItemInDiff,
    onOpenPlan: openPlanPane,
  });

  // Which pane is actually showing. Computed last because it asks
  // whether the plan has anything in it — every mode falls back to the
  // diff when its own precondition is gone (see resolveMode).
  const effMode = resolveMode(mode, {
    hasSession: Boolean(sessionName),
    hasDrafts,
    hasPr: pr != null,
    // A plan belongs to a pull request: it is a queue of *its* review
    // comments, and the prompt names them. A bare worktree has none.
    hasPlan: plan.count > 0,
  });

  return (
    <div ref={rootRef} className="flex h-full min-h-0 min-w-0 flex-col">
      {pr ? (
        <PrHeader pr={pr} />
      ) : (
        <BranchHeader
          branch={branch}
          baseBranch={baseBranch}
          fileCount={files.length}
        />
      )}
      <div className="flex min-h-0 min-w-0 flex-1">
        {railHidden ? (
          <div className="flex w-9 shrink-0 flex-col items-center border-r border-border bg-sidebar pt-1">
            <Tip label="Show review sidebar" side="right">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setRailHidden(false)}
                aria-label="Show review sidebar"
              >
                <PanelLeftOpenIcon />
              </Button>
            </Tip>
          </div>
        ) : null}

        <Group orientation="horizontal" className="min-h-0 min-w-0 flex-1">
          {!railHidden && (
            <>
              <Panel
                id="review-rail"
                defaultSize="270px"
                minSize="200px"
                maxSize="45%"
                className="min-w-0"
              >
                <ReviewRail
                  hasPr={Boolean(pr)}
                  overviewActive={effMode === 'overview'}
                  onOverview={() => setMode('overview')}
                  running={running}
                  busy={busy}
                  hasSession={Boolean(sessionName)}
                  agentActive={effMode === 'agent'}
                  onSelectAgent={() => setMode('agent')}
                  onLaunch={onLaunch}
                  onStop={onStop}
                  onHide={() => setRailHidden(true)}
                  drafts={drafts}
                  reviewActive={effMode === 'review'}
                  onReview={() => setMode('review')}
                  postingAll={postAll.isPending}
                  onPostAll={() =>
                    postAll.mutate(
                      { prId, headSha: pr?.headSha },
                      {
                        onSuccess: (n) =>
                          toast.success(
                            `Posted ${n} comment${n === 1 ? '' : 's'}`
                          ),
                        onError: (e) =>
                          toast.error(`Post failed: ${errorMessage(e)}`),
                      }
                    )
                  }
                  planCount={plan.count}
                  planNoted={plan.noted}
                  planActive={effMode === 'plan'}
                  onPlan={openPlanPane}
                  entries={entries}
                  diffLoading={diffPending}
                  selectedFile={effMode === 'diff' ? nav.selectedFile : null}
                  onSelectFile={nav.jumpToFile}
                  commentItems={nav.items}
                  activeCommentId={effMode === 'diff' ? nav.focusId : null}
                  onJumpComment={nav.jumpToItem}
                  onCommentContextMenu={(row) =>
                    plan.onCommentContextMenu(row.id)
                  }
                />
              </Panel>
              <PanelSeparator className="relative w-px bg-border transition-colors after:absolute after:inset-y-0 after:-left-1 after:w-2 hover:bg-primary data-[resize-handle-state=drag]:bg-primary" />
            </>
          )}

          <Panel id="review-content" minSize="30%" className="min-w-0">
            <ContentPane
              effMode={effMode}
              pr={pr}
              prId={prId}
              branch={branch}
              baseBranch={baseBranch}
              sessionName={sessionName}
              sessionEpoch={sessionEpoch}
              active={active}
              connectionBanner={connectionBanner}
              inputDisabled={inputDisabled}
              files={files}
              filesByName={filesByName}
              fileOrder={fileOrder}
              threadsByFile={threadsByFile}
              draftsByFile={draftsByFile}
              general={general}
              hideResolved={options.hideResolved}
              drafts={drafts}
              hasDrafts={hasDrafts}
              commentsLoading={comments.isLoading}
              diffPending={diffPending}
              diffError={diff.error}
              focusThreadId={nav.focusId}
              scrollRef={nav.scrollRef}
              jumpRef={nav.jumpRef}
              navCount={nav.items.length}
              navIndex={nav.navIndex}
              onPrev={() => nav.step(-1)}
              onNext={() => nav.step(1)}
              onExitReview={showDiff}
              onOpenInDiff={nav.jumpToFile}
              plan={plan.wiring}
            />
          </Panel>
        </Group>
      </div>
    </div>
  );
}
