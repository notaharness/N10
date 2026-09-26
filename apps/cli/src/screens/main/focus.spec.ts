import { worktreeSessionKey } from '@n10/core';
import { describe, it, expect } from 'vitest';
import {
  getMainFocused,
  getSidebarFocused,
  getPaneTitle,
  type FocusState,
  type PaneTitleState,
} from './focus.js';

const baseFocus: FocusState = {
  navFocus: 'sidebar',
  paneMode: 'terminal',
  branchPickerCreating: false,
  settingsOpen: false,
  sessionMenuActive: false,
  deleteConfirmActive: false,
};

const baseTitle: PaneTitleState = {
  paneMode: 'terminal',
  branchPickerCreating: false,
  settingsOpen: false,
  controlsOpen: false,
  sessionMenuActive: false,
  agentId: undefined,
  aiCommand: undefined,
  prTitle: undefined,
  sessionName: null,
  terminalFocused: false,
};

describe('getMainFocused', () => {
  it('is false when nav.focus is sidebar and nothing else is active', () => {
    expect(getMainFocused(baseFocus)).toBe(false);
  });

  it('is true when nav.focus is terminal', () => {
    expect(getMainFocused({ ...baseFocus, navFocus: 'terminal' })).toBe(true);
  });

  it('is true in diff mode even when nav.focus is sidebar (visual/input alignment)', () => {
    // Regression guard: DiffPane's useInput is the real input sink in
    // diff mode, so the main pane must show as focused.
    expect(getMainFocused({ ...baseFocus, paneMode: 'diff' })).toBe(true);
    expect(getMainFocused({ ...baseFocus, paneMode: 'diff-file' })).toBe(true);
  });

  it('is true when the branch picker is open', () => {
    expect(getMainFocused({ ...baseFocus, branchPickerCreating: true })).toBe(
      true
    );
  });

  it('is true when settings are open', () => {
    expect(getMainFocused({ ...baseFocus, settingsOpen: true })).toBe(true);
  });

  it('is true when the review confirm overlay is active', () => {
    expect(getMainFocused({ ...baseFocus, sessionMenuActive: true })).toBe(
      true
    );
  });

  it('is false when the delete confirm modal owns focus', () => {
    // The modal takes focus exclusively — neither pane is highlighted.
    expect(
      getMainFocused({
        ...baseFocus,
        navFocus: 'terminal',
        deleteConfirmActive: true,
      })
    ).toBe(false);
  });
});

describe('getSidebarFocused', () => {
  it('is the inverse of getMainFocused in normal modes', () => {
    expect(getSidebarFocused(baseFocus)).toBe(true);
    expect(getSidebarFocused({ ...baseFocus, navFocus: 'terminal' })).toBe(
      false
    );
    expect(getSidebarFocused({ ...baseFocus, paneMode: 'diff' })).toBe(false);
  });

  it('is false when the delete confirm modal owns focus', () => {
    expect(getSidebarFocused({ ...baseFocus, deleteConfirmActive: true })).toBe(
      false
    );
  });
});

describe('getPaneTitle', () => {
  it('displays the row’s branch rather than the qualified registry key', () => {
    expect(
      getPaneTitle({
        ...baseTitle,
        sessionName: worktreeSessionKey(
          '/repo/.claude/worktrees/feature-login',
          '/repo'
        ),
        rowLabel: 'feature/login',
      })
    ).toBe('🤖 Claude — feature/login');
  });

  it('falls back to the checkout’s directory without a row label', () => {
    expect(
      getPaneTitle({
        ...baseTitle,
        sessionName: worktreeSessionKey(
          '/repo/.claude/worktrees/feature-login',
          '/repo'
        ),
      })
    ).toBe('🤖 Claude — feature-login');
  });
  // ── Terminal mode (default) — 🤖 AgentName — label ──────────────

  it('defaults to "🤖 Claude" when no session, no aiCommand configured', () => {
    expect(getPaneTitle(baseTitle)).toBe('\u{1F916} Claude');
  });

  it('shows "🤖 Claude — branch" with a session name (default agent)', () => {
    expect(getPaneTitle({ ...baseTitle, sessionName: 'feature-foo' })).toBe(
      '\u{1F916} Claude \u2014 feature-foo'
    );
  });

  it('prefers PR title over session name', () => {
    expect(
      getPaneTitle({
        ...baseTitle,
        sessionName: 'feature-foo',
        prTitle: 'Fix navigation bug',
      })
    ).toBe('\u{1F916} Claude \u2014 Fix navigation bug');
  });

  it('resolves agent name from aiCommand using AI_PRESETS', () => {
    expect(
      getPaneTitle({ ...baseTitle, aiCommand: 'codex', sessionName: 'branch' })
    ).toBe('\u{1F916} Codex \u2014 branch');

    expect(getPaneTitle({ ...baseTitle, aiCommand: 'gemini' })).toBe(
      '\u{1F916} Gemini'
    );

    expect(
      getPaneTitle({ ...baseTitle, aiCommand: 'copilot', sessionName: 'x' })
    ).toBe('\u{1F916} Copilot \u2014 x');
  });

  it('falls back to "Agent" for custom/unrecognized aiCommand', () => {
    expect(
      getPaneTitle({
        ...baseTitle,
        aiCommand: 'my-custom-tool --flag',
        sessionName: 'branch',
      })
    ).toBe('\u{1F916} Agent \u2014 branch');
  });

  it('uses the full default command string for Claude', () => {
    expect(
      getPaneTitle({
        ...baseTitle,
        aiCommand: 'claude --continue || claude',
        sessionName: 'x',
      })
    ).toBe('\u{1F916} Claude \u2014 x');
  });

  it('appends the ctrl+space hint when the terminal is focused', () => {
    expect(
      getPaneTitle({
        ...baseTitle,
        sessionName: 'feature-foo',
        terminalFocused: true,
      })
    ).toBe('\u{1F916} Claude \u2014 feature-foo (ctrl+space to exit)');
  });

  it('appends the hint even without a session label', () => {
    expect(getPaneTitle({ ...baseTitle, terminalFocused: true })).toBe(
      '\u{1F916} Claude (ctrl+space to exit)'
    );
  });

  it('does not append the hint outside terminal mode', () => {
    expect(
      getPaneTitle({
        ...baseTitle,
        paneMode: 'diff',
        terminalFocused: true,
      })
    ).toBe('Files Changed');
  });

  // ── Non-terminal modes (unchanged from before) ──────────────────

  it('returns "Files Changed" in diff modes', () => {
    expect(getPaneTitle({ ...baseTitle, paneMode: 'diff' })).toBe(
      'Files Changed'
    );
    expect(getPaneTitle({ ...baseTitle, paneMode: 'diff-file' })).toBe(
      'Files Changed'
    );
  });

  it('returns "Pull Request" in pr-detail mode', () => {
    expect(getPaneTitle({ ...baseTitle, paneMode: 'pr-detail' })).toBe(
      'Pull Request'
    );
  });

  it('returns "New Session" when the branch picker is open', () => {
    expect(getPaneTitle({ ...baseTitle, branchPickerCreating: true })).toBe(
      'New Session'
    );
  });

  it('returns "Settings" when settings are open', () => {
    expect(getPaneTitle({ ...baseTitle, settingsOpen: true })).toBe('Settings');
  });

  it('returns "Controls" when controls sub-screen is open (takes precedence over Settings)', () => {
    expect(
      getPaneTitle({ ...baseTitle, settingsOpen: true, controlsOpen: true })
    ).toBe('Controls');
  });

  it('returns "Session Menu" when the session menu overlay is active', () => {
    expect(getPaneTitle({ ...baseTitle, sessionMenuActive: true })).toBe(
      'Session Menu'
    );
  });
});
