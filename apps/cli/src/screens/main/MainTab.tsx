import { useCallback, useMemo, useState } from 'react';
import { useInput, Box } from 'ink';
import { Sidebar } from '../../components/Sidebar.js';
import { useSidebarMouse } from './useSidebarMouse.js';
import { Pane } from '../../components/Pane.js';
import { SessionTabBar } from '../../components/SessionTabBar.js';
import {
  useRunningTabs,
  useNavState,
  useNavActions,
  useAsyncOps,
  useInactiveAlertWatcher,
  useBranchPickerState,
  useBranchPickerActions,
  useDeleteConfirmState,
  useDeleteConfirmActions,
  useSettingsState,
  useSettingsActions,
  useLayout,
  LAYOUT,
  useSessionActions,
  useConfig,
  useKeybinds,
  useSidebar,
  usePaneReducer,
} from '@n10/app-core';
import { dequeueOldest, getItemKey, getSession } from '@n10/core';
import { TopRightOverlay } from '../../components/TopRightOverlay.js';
import { handleSessionMenuInput, handleSidebarInput } from './main-input.js';
import { MainContent } from './MainContent.js';
import { getMainFocused, getSidebarFocused, getPaneTitle } from './focus.js';

interface MainTabProps {
  terminalFocused: boolean;
  showOnboarding: boolean;
  exit: () => void;
}

// MainTab holds an always-on no-op useInput to keep Ink's raw-mode
// ref-count above zero while MainTabBody remounts on sidebar-item
// changes. Without this guard the selected-item remount would briefly
// tear down the only useInput in the tree, flipping raw-mode off and
// causing character echo in the terminal.
//
// hintsHidden lives here, not in MainTabBody — the body remounts on
// every sidebar selection change, which would reset the toggle.
export function MainTab(props: MainTabProps) {
  useInput(() => {
    // Intentionally empty — see comment above.
  });

  const sidebar = useSidebar();
  const itemKey = sidebar.selectedItem
    ? getItemKey(sidebar.selectedItem)
    : 'empty';

  const [hintsHidden, setHintsHidden] = useState(false);
  const toggleHints = useCallback(() => setHintsHidden((v) => !v), []);

  return (
    <MainTabBody
      key={itemKey}
      {...props}
      hintsHidden={hintsHidden}
      toggleHints={toggleHints}
    />
  );
}

interface MainTabBodyProps extends MainTabProps {
  hintsHidden: boolean;
  toggleHints: () => void;
}

/** True when any modal that owns its own input handler is open. */
function getAnyModalOpen(
  branchPickerCreating: boolean,
  deleteConfirmOpen: boolean,
  settingsOpen: boolean
): boolean {
  return branchPickerCreating || deleteConfirmOpen || settingsOpen;
}

function attachedSession(name: string | null) {
  return name ? getSession(name) : undefined;
}

// MainTabBody owns the pane state + the real input router. React
// unmounts and remounts it whenever `itemKey` changes (see MainTab
// above), so `usePaneReducer`'s lazy initializer picks a fresh pane
// mode via defaultPaneMode() — no render-time setState to reset.
function MainTabBody({
  terminalFocused,
  showOnboarding,
  exit,
  hintsHidden,
  toggleHints,
}: MainTabBodyProps) {
  const navState = useNavState();
  const navActions = useNavActions();
  const nav = useMemo(
    () => ({ ...navState, ...navActions }),
    [navState, navActions]
  );
  const asyncOps = useAsyncOps();
  const branchPickerState = useBranchPickerState();
  const branchPickerActions = useBranchPickerActions();
  const deleteConfirmState = useDeleteConfirmState();
  const deleteConfirmActions = useDeleteConfirmActions();
  const settingsState = useSettingsState();
  const settingsActions = useSettingsActions();
  const branchPicker = useMemo(
    () => ({ ...branchPickerState, ...branchPickerActions }),
    [branchPickerState, branchPickerActions]
  );
  const deleteConfirm = useMemo(
    () => ({ ...deleteConfirmState, ...deleteConfirmActions }),
    [deleteConfirmState, deleteConfirmActions]
  );
  const settings = useMemo(
    () => ({ ...settingsState, ...settingsActions }),
    [settingsState, settingsActions]
  );
  const layout = useLayout();
  const { terminal } = layout;
  const sessionCtx = useSessionActions();
  const configCtx = useConfig();
  const keybinds = useKeybinds();
  const sidebar = useSidebar();
  const { numbers: tabNumbers } = useRunningTabs();

  const pane = usePaneReducer(
    sidebar.selectedItem,
    sidebar.sessionNameForTerminal
  );

  // ── Input handling (modals + sidebar) ──────────────────────────
  useInput((input, key) => {
    if (terminalFocused || showOnboarding) return;

    // Modals own their own useInput hooks — skip so we don't
    // double-route. Branch picker, delete-confirm, settings, and the
    // controls sub-screen each have a nested useInput({ isActive }).
    if (branchPicker.creating) return;
    if (deleteConfirm.confirmDelete) return;
    if (settings.settingsOpen) return;

    if (pane.sessionMenu) {
      return handleSessionMenuInput(input, key, {
        pane,
        nav,
        asyncOps,
        sessions: sessionCtx,
        sidebar,
        terminal,
        config: configCtx,
        selectedItem: sidebar.selectedItem,
        sessionNameForTerminal: sidebar.sessionNameForTerminal,
        keybinds,
      });
    }

    // Diff input is handled by DiffPane's own useInput
    if (
      pane.paneMode === 'diff' ||
      pane.paneMode === 'diff-file' ||
      pane.paneMode === 'comments' ||
      pane.paneMode === 'plan-checkout'
    )
      return;

    handleSidebarInput(input, key, {
      nav,
      config: configCtx,
      sessions: sessionCtx,
      sidebar,
      branchPicker,
      deleteConfirm,
      settings,
      asyncOps,
      terminal,
      pane,
      keybinds,
      toggleHints,
      exit,
    });
  });

  // ── Render ─────────────────────────────────────────────────────
  // Single source of truth for which pane shows the active border color.
  // Both getMainFocused and getSidebarFocused are pure helpers (see
  // ./focus.ts) that stay aligned with the actual input sink — crucially,
  // diff modes count as main-focused because DiffPane.useInput is the
  // real input handler there, not the sidebar.
  const focusState = {
    navFocus: nav.focus,
    paneMode: pane.paneMode,
    branchPickerCreating: branchPicker.creating,
    settingsOpen: settings.settingsOpen,
    sessionMenuActive: pane.sessionMenu !== null,
    deleteConfirmActive: deleteConfirm.confirmDelete !== null,
  };
  const mainFocused = getMainFocused(focusState);
  const sidebarFocused = getSidebarFocused(focusState);

  const attached = attachedSession(sidebar.sessionNameForTerminal);
  const paneTitle = getPaneTitle({
    sessionAgent: attached?.agent,
    hasAttachedSession: !!attached,
    paneMode: pane.paneMode,
    branchPickerCreating: branchPicker.creating,
    settingsOpen: settings.settingsOpen,
    controlsOpen: settings.controlsOpen,
    sessionMenuActive: pane.sessionMenu !== null,
    agentId: configCtx.config.agentId,
    aiCommand: configCtx.config.aiCommand,
    prTitle: sidebar.selectedPr?.title,
    sessionName: sidebar.sessionNameForTerminal,
    rowLabel: sidebar.selectedRowLabel,
    terminalFocused,
  });

  // Auto-hide the sidebar while the user is driving an agent session or
  // scanning a diff, so the content pane can reclaim the full width.
  // undefined → default on; explicit false opts out.
  const autoHideEnabled = configCtx.config.autoHideSidebar !== false;
  const hideablePaneMode =
    pane.paneMode === 'terminal' ||
    pane.paneMode === 'diff' ||
    pane.paneMode === 'diff-file';
  const sidebarHidden =
    autoHideEnabled && nav.focus === 'terminal' && hideablePaneMode;

  const effectiveTerminal = sidebarHidden
    ? {
        paneCols: Math.max(20, layout.termCols - LAYOUT.PANE_BORDER_COLS),
        paneRows: terminal.paneRows,
      }
    : terminal;
  const showPlanIndicator = pane.paneMode !== 'plan-checkout';

  // Wheel / click over the sidebar column (see useSidebarMouse). Inert
  // whenever another surface owns input or the sidebar is hidden — the
  // same gate the sidebar's own keyboard handler uses.
  const anyModalOpen = getAnyModalOpen(
    branchPicker.creating,
    deleteConfirm.confirmDelete != null,
    settings.settingsOpen
  );
  useSidebarMouse({
    active:
      !terminalFocused && !showOnboarding && !anyModalOpen && !sidebarHidden,
    sidebarWidth: layout.sidebarWidth,
    items: sidebar.items,
    moveSelection: sidebar.moveSelection,
    selectByKey: sidebar.selectByKey,
  });

  useInactiveAlertWatcher(sidebar.sessionNameForTerminal);

  const jumpEnabled = configCtx.config.jumpToInactiveOnEscape !== false;
  const onTerminalEscape = useCallback(() => {
    if (jumpEnabled) {
      const next = dequeueOldest();
      if (next != null) {
        sidebar.selectByKey(`session:${next}`);
        return; // stay terminal-focused; selection drives which PTY shows
      }
    }
    nav.setFocus('sidebar');
  }, [jumpEnabled, sidebar, nav]);

  return (
    <>
      {!sidebarHidden && (
        <Sidebar
          items={sidebar.items}
          selectedIndex={sidebar.selectedIndex}
          sidebarWidth={layout.sidebarWidth}
          termRows={layout.termRows}
          focused={sidebarFocused}
          hintsHidden={hintsHidden}
          tabNumbers={tabNumbers}
        />
      )}
      <Box flexDirection="column" flexGrow={1}>
        <SessionTabBar />
        <Pane focused={mainFocused} title={paneTitle} flexGrow={1}>
          <MainContent
            pane={pane}
            terminal={effectiveTerminal}
            terminalFocused={terminalFocused}
            sessionNameForTerminal={sidebar.sessionNameForTerminal}
            rowLabel={sidebar.selectedRowLabel}
            selectedPr={sidebar.selectedPr}
            onFocusSidebar={onTerminalEscape}
          />
        </Pane>
      </Box>
      <TopRightOverlay showPlanIndicator={showPlanIndicator} />
    </>
  );
}
