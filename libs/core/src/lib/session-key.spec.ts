import { describe, expect, it } from 'vitest';
import { LOCAL_MACHINE_ID } from '@n10/worktree-manager';
import {
  LOCAL_MACHINE,
  keyForWorktree,
  sessionIdentity,
  terminalSessionKey,
  worktreeSessionKey,
} from './session-key.js';

describe('session-key (D2: an optional trailing machine segment)', () => {
  it("produces the exact literal today's code produces for a local key, so a future change to the tuple shape fails loudly", () => {
    expect(worktreeSessionKey('feature/x', '/repo')).toBe(
      '["worktree","/repo","feature/x"]'
    );
    expect(terminalSessionKey('alpha-shell')).toBe(
      '["terminal","alpha-shell"]'
    );
  });

  it('omits the machine segment entirely when it is local, byte-identical to a call that never mentions machine', () => {
    expect(worktreeSessionKey('feature/x', '/repo', LOCAL_MACHINE)).toBe(
      worktreeSessionKey('feature/x', '/repo')
    );
    expect(terminalSessionKey('alpha-shell', LOCAL_MACHINE)).toBe(
      terminalSessionKey('alpha-shell')
    );
  });

  it('appends the machine as a trailing segment when remote', () => {
    expect(worktreeSessionKey('feature/x', '/repo', 'peer-abc')).toBe(
      '["worktree","/repo","feature/x","peer-abc"]'
    );
    expect(terminalSessionKey('alpha-shell', 'peer-abc')).toBe(
      '["terminal","alpha-shell","peer-abc"]'
    );
  });

  // The collision D2 exists to fix: a remote terminal key and a local
  // worktree key are both length-3 tuples. A length-and-kind parse
  // mismatches the terminal one against neither arm and returns null;
  // the kind-first parse in session-key.ts must get both right in the
  // same test, since they are the pair that collides on length.
  it('parses a remote terminal key and a local worktree key correctly in the same test, despite both being length-3 tuples', () => {
    const remoteTerminal = terminalSessionKey('alpha-shell', 'peer-abc');
    const localWorktree = worktreeSessionKey('feature/x', '/repo');

    expect(JSON.parse(remoteTerminal)).toHaveLength(3);
    expect(JSON.parse(localWorktree)).toHaveLength(3);

    expect(sessionIdentity(remoteTerminal)).toEqual({
      kind: 'terminal',
      id: 'alpha-shell',
      machine: 'peer-abc',
    });
    expect(sessionIdentity(localWorktree)).toEqual({
      kind: 'worktree',
      repo: '/repo',
      branch: 'feature/x',
      machine: 'local',
    });
  });

  it('parses a remote worktree key (length 4)', () => {
    const key = worktreeSessionKey('feature/x', '/repo', 'peer-abc');
    expect(sessionIdentity(key)).toEqual({
      kind: 'worktree',
      repo: '/repo',
      branch: 'feature/x',
      machine: 'peer-abc',
    });
  });

  it('defaults machine to "local" for a legacy key with no machine segment', () => {
    expect(sessionIdentity('["terminal","alpha-shell"]')).toEqual({
      kind: 'terminal',
      id: 'alpha-shell',
      machine: 'local',
    });
    expect(sessionIdentity('["worktree","/repo","feature/x"]')).toEqual({
      kind: 'worktree',
      repo: '/repo',
      branch: 'feature/x',
      machine: 'local',
    });
  });

  it('rejects malformed and unrelated keys', () => {
    expect(sessionIdentity('not json')).toBeNull();
    expect(sessionIdentity('{}')).toBeNull();
    expect(sessionIdentity('["worktree","/repo"]')).toBeNull();
    expect(
      sessionIdentity('["worktree","/repo","x","peer","extra"]')
    ).toBeNull();
    expect(sessionIdentity('["terminal","x","peer","extra"]')).toBeNull();
    expect(sessionIdentity('["terminal",5]')).toBeNull();
    expect(sessionIdentity('["mystery","x"]')).toBeNull();
  });

  // The `'local'` sentinel is deliberately declared twice: core depends
  // on worktree-manager, never the reverse, so neither package can own
  // the other's constant. Nothing but this assertion stops a rename on
  // one side from quietly desynchronising `isRemoteMachine()` from the
  // key shape here — both are plain strings, so the compiler says
  // nothing. Keep them equal or change both.
  it('agrees with worktree-manager on the local-machine sentinel', () => {
    expect(LOCAL_MACHINE).toBe(LOCAL_MACHINE_ID);
  });

  it('keyForWorktree stays local-only (no machine parameter) and unaffected by D2', () => {
    expect(keyForWorktree({ branch: 'feature/x', path: '/x/feature/x' })).toBe(
      worktreeSessionKey('feature/x')
    );
  });
});
