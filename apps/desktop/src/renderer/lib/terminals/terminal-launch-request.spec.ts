import { describe, expect, it } from 'vitest';
import {
  REMOTE_HOME_CWD,
  terminalLaunchRequest,
} from './terminal-launch-request.js';

describe('terminalLaunchRequest', () => {
  it('a local launch submits exactly the request it submits today (pinned)', () => {
    expect(
      terminalLaunchRequest('shell', '/repo', { cols: 120, rows: 40 })
    ).toStrictEqual({
      kind: 'shell',
      cwd: '/repo',
      cols: 120,
      rows: 40,
    });
  });

  it('a local launch never carries a machine or a launchId, even if passed', () => {
    // launchTerminal never calls this with a machine and no launchId is
    // ever minted for a local launch, but the builder itself must not
    // leak the field when machine is falsy regardless.
    const req = terminalLaunchRequest('shell', '/repo', {});
    expect(req).not.toHaveProperty('machine');
    expect(req).not.toHaveProperty('launchId');
  });

  it('a remote launch carries the machine and the launchId', () => {
    expect(
      terminalLaunchRequest(
        'agent',
        '/repo',
        { cols: 80, rows: 24 },
        'peer-abc',
        'launch-1'
      )
    ).toStrictEqual({
      kind: 'agent',
      cwd: '/repo',
      machine: 'peer-abc',
      launchId: 'launch-1',
      cols: 80,
      rows: 24,
    });
  });

  // Finding 5 (MEDIUM): "open a terminal on <machine>" asks for no
  // directory, so it must send something explicit for the remote
  // launch to interpret — not '', which is neither absolute nor `~/`.
  it('a home-directory request produces a remote-expandable cwd, not an empty one', () => {
    expect(REMOTE_HOME_CWD).toBe('~/');
    const req = terminalLaunchRequest('shell', REMOTE_HOME_CWD, {}, 'peer-abc');
    expect(req.cwd).toBe('~/');
    expect(req.cwd).not.toBe('');
  });
});
