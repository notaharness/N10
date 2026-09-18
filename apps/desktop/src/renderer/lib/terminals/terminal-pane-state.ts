import type { TerminalKind } from '../../../host/contract.js';

/**
 * What a terminal/agent pane shows for a session's connection and
 * process state (ux-machines.md §6, decisions.md D4) — split out as a
 * pure function so the two affordances' independence is directly
 * testable without mounting anything: `processState` (the exited-agent
 * bar) and `connectionState` (the banner) come from different sources
 * on purpose, and a lost connection must never render as the agent
 * having exited.
 */

export type ConnectionBannerState = 'reconnecting' | 'failed';

export interface TerminalPaneState {
  bannerState: ConnectionBannerState | null;
  /** True only while `connectionState === 'reconnecting'` — keystrokes
   *  that would go nowhere are worse than a visibly blocked prompt. */
  inputDisabled: boolean;
  /** The "Resume agent" / "Start new" bar, gated on `processState`
   *  (`running`) alone — never on `connectionState`. */
  showExitedBar: boolean;
}

export function terminalPaneState(session: {
  kind: TerminalKind;
  running: boolean;
  connectionState?: 'connected' | 'reconnecting' | 'failed';
}): TerminalPaneState {
  const cs = session.connectionState;
  const bannerState = cs === 'reconnecting' || cs === 'failed' ? cs : null;
  return {
    bannerState,
    inputDisabled: cs === 'reconnecting',
    showExitedBar: session.kind === 'agent' && !session.running,
  };
}
