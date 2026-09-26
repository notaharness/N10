// Pure helpers that decide which pane (sidebar or main) is visually
// "focused" and what title the main pane should display. Extracted from
// MainTab.tsx so the rules live in one place, are easy to unit-test, and
// can't silently drift out of sync with input-handler behavior.
//
// The rules stay in sync with two things:
//   1. The actual input sink — whichever handler's useInput fires.
//   2. The auto-hide sidebar feature (commit 06bd627), which only hides
//      the sidebar when nav.focus === 'terminal'. Our helpers must agree
//      that the sidebar is NOT focused in those cases.

import type { Focus, PaneMode } from '@n10/core';
import { AGENTS, resolveAgent, sessionLabel } from '@n10/core';
import type { AgentId, AppConfig } from '@n10/vcs-core';

export interface FocusState {
  navFocus: Focus;
  paneMode: PaneMode;
  branchPickerCreating: boolean;
  settingsOpen: boolean;
  sessionMenuActive: boolean;
  deleteConfirmActive: boolean;
}

/**
 * Returns true when the main content pane should render with the active
 * border color. Precedence (highest first):
 *   1. Delete confirm modal → NEITHER pane is focused (modal owns focus).
 *   2. Any modal-ish state (branch picker, settings, session menu) →
 *      main pane, because that's where the modal content renders.
 *   3. Diff modes → main pane, because DiffPane's useInput is the sink.
 *   4. Otherwise → whichever side nav.focus points at.
 */
export function getMainFocused(s: FocusState): boolean {
  if (s.deleteConfirmActive) return false;
  if (s.branchPickerCreating) return true;
  if (s.settingsOpen) return true;
  if (s.sessionMenuActive) return true;
  if (
    s.paneMode === 'diff' ||
    s.paneMode === 'diff-file' ||
    s.paneMode === 'comments' ||
    s.paneMode === 'plan-checkout'
  )
    return true;
  return s.navFocus === 'terminal';
}

/**
 * Returns true when the sidebar should render with the active border color.
 * When a delete confirm modal is open, neither pane is focused — the modal
 * has keyboard focus exclusively.
 */
export function getSidebarFocused(s: FocusState): boolean {
  if (s.deleteConfirmActive) return false;
  return !getMainFocused(s);
}

export interface PaneTitleState {
  paneMode: PaneMode;
  branchPickerCreating: boolean;
  settingsOpen: boolean;
  controlsOpen: boolean;
  sessionMenuActive: boolean;
  agentId: AgentId | undefined;
  sessionAgent?: string;
  hasAttachedSession?: boolean;
  aiCommand: string | undefined;
  prTitle: string | undefined;
  sessionName: string | null;
  /** The selected worktree row's label — its branch as checked out
   *  now. The session key names the checkout, not the branch. */
  rowLabel?: string | null;
  /**
   * When true AND we're in terminal mode, the title appends a
   * `· ctrl+space to exit` hint so the user knows how to escape.
   */
  terminalFocused: boolean;
}

/**
 * Human-readable title for the main pane. Precedence matches the render
 * precedence in MainTab / MainContent.
 *
 * In terminal mode the title becomes:
 *   🤖 Claude — Fix navigation bug   (PR title available)
 *   🤖 Claude — feature-foo          (no PR, session/branch name)
 *   🤖 Claude                        (no session selected)
 *   …with ` · ctrl+space to exit` appended when terminalFocused.
 */
/** Modes that name themselves; anything absent falls through to the agent. */
const PANE_MODE_TITLES: Partial<Record<PaneMode, string>> = {
  'pr-detail': 'Pull Request',
  diff: 'Files Changed',
  'diff-file': 'Files Changed',
  'plan-checkout': 'Plan Checkout',
};

/**
 * A screen covering the pane, in the order they cover one another —
 * controls sit on top of settings, which sit on top of the rest.
 */
function overlayTitle(s: PaneTitleState): string | undefined {
  if (s.controlsOpen) return 'Controls';
  if (s.settingsOpen) return 'Settings';
  if (s.branchPickerCreating) return 'New Session';
  if (s.sessionMenuActive) return 'Session Menu';
  return undefined;
}

export function getPaneTitle(s: PaneTitleState): string {
  const named = overlayTitle(s) ?? PANE_MODE_TITLES[s.paneMode];
  if (named) return named;

  // Resolve the display name through the agent registry so it honors an
  // explicit agentId or a legacy aiCommand. The hidden test runner (and
  // any unrecognized command) shows the generic "Agent".
  const resolved = resolveAgent({
    agentId: s.agentId,
    aiCommand: s.aiCommand,
  } as AppConfig);
  const agent = s.hasAttachedSession
    ? AGENTS.find((a) => a.id === s.sessionAgent)?.name ?? 'Agent'
    : resolved.hidden
    ? 'Agent'
    : resolved.name;
  const label =
    s.prTitle ||
    s.rowLabel ||
    (s.sessionName ? sessionLabel(s.sessionName) : null);
  const base = label
    ? `\u{1F916} ${agent} \u2014 ${label}`
    : `\u{1F916} ${agent}`;
  return s.terminalFocused ? `${base} (ctrl+space to exit)` : base;
}
