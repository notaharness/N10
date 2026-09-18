import { describe, expect, it } from 'vitest';
import { terminalPaneState } from './terminal-pane-state.js';

describe('terminalPaneState', () => {
  it('a healthy running agent shows neither banner nor exited bar', () => {
    expect(
      terminalPaneState({
        kind: 'agent',
        running: true,
        connectionState: 'connected',
      })
    ).toEqual({
      bannerState: null,
      inputDisabled: false,
      showExitedBar: false,
    });
  });

  it('reconnecting: banner shown, input disabled, no exited bar even for an agent', () => {
    const s = terminalPaneState({
      kind: 'agent',
      running: true,
      connectionState: 'reconnecting',
    });
    expect(s.bannerState).toBe('reconnecting');
    expect(s.inputDisabled).toBe(true);
    expect(s.showExitedBar).toBe(false);
  });

  it('failed: banner shown, input not disabled (already blocked, nothing to lose), no exited bar', () => {
    const s = terminalPaneState({
      kind: 'agent',
      running: true,
      connectionState: 'failed',
    });
    expect(s.bannerState).toBe('failed');
    expect(s.inputDisabled).toBe(false);
    expect(s.showExitedBar).toBe(false);
  });

  it('a real exit (processState) shows the exited bar and no banner', () => {
    const s = terminalPaneState({
      kind: 'agent',
      running: false,
      connectionState: 'connected',
    });
    expect(s.bannerState).toBeNull();
    expect(s.showExitedBar).toBe(true);
  });

  // The pairing that matters most: a connection problem must never be
  // mistaken for the agent exiting, and vice versa.
  it('a dropped connection on a still-running agent never shows the exited bar', () => {
    const s = terminalPaneState({
      kind: 'agent',
      running: true,
      connectionState: 'failed',
    });
    expect(s.showExitedBar).toBe(false);
    expect(s.bannerState).toBe('failed');
  });

  it('the exited bar is agent-only — a shell exiting shows neither affordance', () => {
    const s = terminalPaneState({
      kind: 'shell',
      running: false,
      connectionState: 'connected',
    });
    expect(s.showExitedBar).toBe(false);
  });

  it('no connectionState at all (a plain local session) shows no banner', () => {
    expect(
      terminalPaneState({ kind: 'agent', running: true }).bannerState
    ).toBeNull();
  });
});
