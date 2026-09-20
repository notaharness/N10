import { describe, expect, it } from 'vitest';
import type {
  AgentOptionView,
  SessionLaunchView,
} from '../../../host/contract.js';
import {
  actionLabel,
  isReplacing,
  launchChoice,
  resolvedConfigDir,
  selectedMode,
  shouldShowConfigDirPicker,
} from './launch-dialog-model.js';

const view = (over: Partial<SessionLaunchView> = {}): SessionLaunchView =>
  ({
    exists: true,
    running: true,
    canResume: true,
    recordedAgentName: 'Claude',
    incarnation: { name: 'wt' },
    ...over,
  } as SessionLaunchView);

const agents = (...ids: string[]): AgentOptionView[] =>
  ids.map((id) => ({ id, name: id } as AgentOptionView));

const DIRS = ['~/.claude', '~/.claude-work'];

describe('what a launch replaces', () => {
  it('a new conversation takes the branch session', () => {
    expect(isReplacing('new', view())).toBe(true);
    expect(actionLabel('new', view(), true)).toBe('Stop and start new session');
  });

  it('a review does not, however busy the branch is', () => {
    // It runs in a session of its own, so the agent working on the
    // branch is left alone — the dialog must not offer to stop it.
    expect(isReplacing('review', view({ running: true }))).toBe(false);
    expect(actionLabel('review', view({ running: true }), false)).toBe(
      'Start review'
    );
  });

  it('a review carries no incarnation guard', () => {
    // The guard exists to confirm which session is being replaced.
    // A review replaces none, so sending one would be meaningless.
    const choice = launchChoice('review', view(), '', 'claude', false, '');
    expect(choice).toMatchObject({ kind: 'review' });
    expect('expected' in choice).toBe(false);
  });

  it('a new session still carries one', () => {
    expect(launchChoice('new', view(), '', 'claude', false, '')).toMatchObject({
      kind: 'session',
      fresh: true,
      expected: { name: 'wt' },
    });
  });
});

describe('the config directory picker', () => {
  it('is shown only with something to choose between', () => {
    expect(shouldShowConfigDirPicker('new', DIRS, agents('claude'), 0)).toBe(
      true
    );
    expect(
      shouldShowConfigDirPicker('new', ['~/.claude'], agents('claude'), 0)
    ).toBe(false);
  });

  it('is hidden for an agent that does not read one', () => {
    expect(
      shouldShowConfigDirPicker('new', DIRS, agents('codex', 'claude'), 0)
    ).toBe(false);
  });

  it('is hidden while continuing, which reuses the session as it is', () => {
    expect(
      shouldShowConfigDirPicker('continue', DIRS, agents('claude'), 0)
    ).toBe(false);
  });

  it('defaults to the first entry until the user picks', () => {
    expect(resolvedConfigDir(undefined, DIRS)).toBe('~/.claude');
    expect(resolvedConfigDir('~/.claude-work', DIRS)).toBe('~/.claude-work');
  });

  it('sends a token only when it was actually shown', () => {
    // "Unset" is meaningful: it leaves the host's own default in
    // force. Sending a token the user never saw would override it.
    expect(
      launchChoice('new', view(), '', 'claude', true, '~/.claude-work')
    ).toMatchObject({ configDir: '~/.claude-work' });
    expect(
      launchChoice('new', view(), '', 'claude', false, '~/.claude-work')
        .configDir
    ).toBeUndefined();
  });
});

describe('mode selection', () => {
  it('falls back to a new session when continuing is not on offer', () => {
    expect(selectedMode('continue', false)).toBe('new');
    expect(selectedMode(null, true)).toBe('continue');
    expect(selectedMode(null, false)).toBe('new');
  });
});
