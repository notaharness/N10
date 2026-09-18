import { describe, it, expect, vi, beforeEach } from 'vitest';

const sessionNames = vi.fn();
const getSession = vi.fn();
vi.mock('../pty-registry.js', () => ({
  sessionNames: () => sessionNames(),
  getSession: (name: string) => getSession(name),
}));

const sessionIdentity = vi.fn();
vi.mock('../session-key.js', () => ({
  sessionIdentity: (key: string) => sessionIdentity(key),
}));

const tmuxListSessions = vi.fn();
vi.mock('@n10/terminal-tmux', () => ({
  tmuxListSessions: () => tmuxListSessions(),
}));

import { parseRelayPayload, resolveLocalRelayTarget } from './relay-target.js';

function entry(name: string, agent: string | undefined) {
  return { pty: { name }, agent, exited: false, emu: {}, spawnedAt: 0 };
}

describe('parseRelayPayload', () => {
  it('splits the "target: <local>" header from the message body', () => {
    expect(
      parseRelayPayload('target: tmux:foo\n\nhello\nworld', 'utf8')
    ).toEqual({ target: 'tmux:foo', message: 'hello\nworld' });
  });

  it('decodes a base64 payload before parsing', () => {
    const raw = Buffer.from('target: tmux:foo\n\nhi', 'utf8').toString(
      'base64'
    );
    expect(parseRelayPayload(raw, 'base64')).toEqual({
      target: 'tmux:foo',
      message: 'hi',
    });
  });

  it('returns null when there is no "target: " header', () => {
    expect(parseRelayPayload('just some text', 'utf8')).toBeNull();
  });
});

describe('resolveLocalRelayTarget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionNames.mockReturnValue([]);
    tmuxListSessions.mockReturnValue([]);
  });

  it('refuses a codex target honestly, without guessing a mapping', () => {
    const result = resolveLocalRelayTarget('codex:1234');
    expect(result).toEqual({
      kind: 'refused',
      reason:
        "codex targets are not delivered by n10 desktop; use Orchestra's relay.sh for those",
    });
  });

  it('refuses an unrecognised target shape', () => {
    const result = resolveLocalRelayTarget('shell:foo');
    expect(result.kind).toBe('refused');
  });

  it('resolves a tmux target to the local agent session the registry allocated it under', () => {
    sessionNames.mockReturnValue(['key-1']);
    getSession.mockReturnValue(entry('n10-feature-x', 'claude'));
    sessionIdentity.mockReturnValue({
      kind: 'worktree',
      repo: '/r',
      branch: 'feature/x',
      machine: 'local',
    });
    const result = resolveLocalRelayTarget('tmux:n10-feature-x');
    expect(result).toEqual({ kind: 'agent', key: 'key-1' });
  });

  it('refuses a target that resolves to nothing n10 knows about', () => {
    sessionNames.mockReturnValue([]);
    tmuxListSessions.mockReturnValue([]);
    const result = resolveLocalRelayTarget('tmux:nowhere');
    expect(result).toEqual({
      kind: 'refused',
      reason: 'no session by that name is known here',
    });
  });

  it('refuses a foreign tmux session that exists but was not created by n10', () => {
    sessionNames.mockReturnValue([]);
    tmuxListSessions.mockReturnValue(['someone-elses-session']);
    const result = resolveLocalRelayTarget('tmux:someone-elses-session');
    expect(result).toEqual({
      kind: 'refused',
      reason: 'that tmux session exists but is not managed by n10',
    });
  });

  it('refuses a shell terminal — an agent must own the pane', () => {
    sessionNames.mockReturnValue(['key-1']);
    getSession.mockReturnValue(entry('n10-shell', undefined));
    sessionIdentity.mockReturnValue({
      kind: 'terminal',
      id: 'n10-shell',
      machine: 'local',
    });
    const result = resolveLocalRelayTarget('tmux:n10-shell');
    expect(result).toEqual({
      kind: 'refused',
      reason: 'that session is a shell terminal, not an agent',
    });
  });

  it('refuses a session that lives on another machine', () => {
    sessionNames.mockReturnValue(['key-1']);
    getSession.mockReturnValue(entry('n10-remote', 'claude'));
    sessionIdentity.mockReturnValue({
      kind: 'terminal',
      id: 'n10-remote',
      machine: 'deadbeefcafef00d',
    });
    const result = resolveLocalRelayTarget('tmux:n10-remote');
    expect(result).toEqual({
      kind: 'refused',
      reason: 'that session lives on another machine, not here',
    });
  });
});
