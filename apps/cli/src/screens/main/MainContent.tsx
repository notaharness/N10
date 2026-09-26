import { useMemo, type ReactNode } from 'react';
import type { PullRequestInfo } from '@n10/vcs-core';
import { BranchPicker } from './BranchPicker.js';
import { SettingsPanel } from '../../components/SettingsPanel.js';
import { ControlsPanel } from '../../components/ControlsPanel.js';
import { SessionMenuPane } from './SessionMenuPane.js';
import { ReviewDetailPane } from '../reviews/ReviewDetailPane.js';
import { TerminalPane } from './TerminalPane.js';
import { DiffFileListContainer } from './DiffFileListContainer.js';
import { DiffFileViewerContainer } from './DiffFileViewerContainer.js';
import { GeneralCommentsContainer } from './GeneralCommentsContainer.js';
import { PlanCheckoutContainer } from './PlanCheckoutContainer.js';
import type { TerminalLayout, PaneModeValue } from '@n10/app-core';
import {
  useConfig,
  useDiffBundle,
  useSettingsState,
  useBranchPickerState,
} from '@n10/app-core';
import { CARD_INDENT, CARD_MAX_WIDTH } from '../../components/CommentThread.js';
import { CommentImagesContext } from '../../context/CommentImagesContext.js';
import { useCommentImages } from '../../hooks/useCommentImages.js';

interface MainContentProps {
  pane: PaneModeValue;
  terminal: TerminalLayout;
  terminalFocused: boolean;
  sessionNameForTerminal: string | null;
  /** The selected worktree row's label, its branch as checked out now. */
  rowLabel: string | null;
  selectedPr: PullRequestInfo | undefined;
  onFocusSidebar: () => void;
}

type ScreenType =
  | 'controls'
  | 'settings'
  | 'branchPicker'
  | 'sessionMenu'
  | 'terminal'
  | 'prDetail'
  | 'diff'
  | 'diffFile'
  | 'comments'
  | 'planCheckout';

// Pure router for the main content pane. Renders exactly one of the
// mutually-exclusive sub-panes based on modal and pane-mode state, in
// the same precedence order MainTab used to inline.
//
// Precedence (highest first):
//   1. Controls sub-screen  → ControlsPanel
//   2. Settings             → SettingsPanel
//   3. Branch picker        → BranchPicker
//   4. Session menu         → SessionMenuPane
//   5. Terminal mode        → TerminalPane
//   6. PR detail mode       → ReviewDetailPane
//   7. Diff list            → DiffPane
//   8. Diff file viewer     → DiffPane
/**
 * What `useDiffBundle` needs, with a missing pull request flattened to
 * the empty values that leave it idle. The hook is called
 * unconditionally — the file cache and the comments-dir watch have to
 * survive the list→viewer switch — so there is always something to
 * pass it.
 */
function diffBundleArgs(pr: PullRequestInfo | undefined) {
  return {
    prId: pr?.id ?? null,
    sourceBranch: pr?.sourceBranch ?? '',
    targetBranch: pr?.targetBranch ?? '',
    headSha: pr?.headSha,
  };
}

export function MainContent({
  pane,
  terminal,
  terminalFocused,
  sessionNameForTerminal,
  rowLabel,
  selectedPr,
  onFocusSidebar,
}: MainContentProps) {
  const settings = useSettingsState();
  const branchPicker = useBranchPickerState();
  const { config } = useConfig();

  // One diff-data instance shared by the list + viewer containers.
  // Mounted unconditionally so the in-memory file/diff cache and the
  // fs.watch on the comments dir survive the list→viewer switch.
  const args = diffBundleArgs(selectedPr);
  const diffBundle = useDiffBundle(
    args.prId,
    args.sourceBranch,
    args.targetBranch,
    args.headSha
  );

  const screenType: ScreenType = (() => {
    if (settings.settingsOpen && settings.controlsOpen) return 'controls';
    if (settings.settingsOpen) return 'settings';
    if (branchPicker.creating) return 'branchPicker';
    if (pane.sessionMenu) return 'sessionMenu';
    if (pane.paneMode === 'pr-detail') return 'prDetail';
    if (pane.paneMode === 'diff') return 'diff';
    if (pane.paneMode === 'diff-file') return 'diffFile';
    if (pane.paneMode === 'comments') return 'comments';
    if (pane.paneMode === 'plan-checkout') return 'planCheckout';
    return 'terminal';
  })();

  // Inline comment images (terminal graphics). Every distinct image url
  // across the PR's inline + general threads is fetched, decoded and
  // transmitted to the terminal once; the resulting layouts drive both
  // the comment renderers and the row/height math. Client-driven GIF
  // playback only runs while a reviews surface is on screen.
  const allThreads = useMemo(
    () => [...diffBundle.remote.threads, ...diffBundle.remote.generalComments],
    [diffBundle.remote.threads, diffBundle.remote.generalComments]
  );
  const cardInteriorWidth =
    Math.max(
      20,
      Math.min(CARD_MAX_WIDTH, terminal.paneCols - CARD_INDENT - 2)
    ) - 4;
  const reviewsPaneShowing =
    screenType === 'diff' ||
    screenType === 'diffFile' ||
    screenType === 'comments';
  const commentImages = useCommentImages(
    allThreads,
    cardInteriorWidth,
    config.vendorAuth,
    reviewsPaneShowing
  );

  const screen: ReactNode = (() => {
    switch (screenType) {
      case 'controls':
        return (
          <ControlsPanel
            paneRows={terminal.paneRows}
            selectedIndex={settings.controlsSelectedIndex}
            rebindActionId={settings.controlsRebindActionId}
          />
        );
      case 'settings':
        return (
          <SettingsPanel
            fieldIndex={settings.settingsFieldIndex}
            editingField={settings.editingField}
            editBuffer={settings.editBuffer}
          />
        );
      case 'branchPicker':
        return (
          <BranchPicker
            filter={branchPicker.branchFilter}
            branches={branchPicker.branches}
            selectedIndex={branchPicker.branchIndex}
            paneRows={terminal.paneRows}
            pane={pane}
          />
        );
      case 'sessionMenu':
        return (
          <SessionMenuPane
            pr={pane.sessionMenu!.pr}
            sessionName={sessionNameForTerminal}
            label={rowLabel}
            selectedOption={pane.sessionMenu!.selectedOption}
            agentIndex={pane.sessionMenu!.agentIndex}
            instruction={pane.reviewInstruction}
          />
        );
      case 'terminal':
        return (
          <TerminalPane
            sessionNameForTerminal={sessionNameForTerminal}
            terminal={terminal}
            reconnectKey={pane.reconnectKey}
            terminalFocused={terminalFocused}
            onFocusSidebar={onFocusSidebar}
          />
        );
      case 'prDetail':
        return <ReviewDetailPane pr={selectedPr} />;
      case 'diff':
        return (
          <DiffFileListContainer
            pane={pane}
            terminal={terminal}
            selectedPr={selectedPr}
            terminalFocused={terminalFocused}
            diffBundle={diffBundle}
          />
        );
      case 'diffFile':
        return (
          <DiffFileViewerContainer
            pane={pane}
            terminal={terminal}
            selectedPr={selectedPr}
            terminalFocused={terminalFocused}
            diffBundle={diffBundle}
          />
        );
      case 'comments':
        return (
          <GeneralCommentsContainer
            pane={pane}
            terminal={terminal}
            terminalFocused={terminalFocused}
            diffBundle={diffBundle}
          />
        );
      case 'planCheckout':
        return (
          <PlanCheckoutContainer
            pane={pane}
            terminal={terminal}
            selectedPr={selectedPr}
            terminalFocused={terminalFocused}
          />
        );
    }
  })();

  return (
    <CommentImagesContext.Provider value={commentImages}>
      {screen}
    </CommentImagesContext.Provider>
  );
}
