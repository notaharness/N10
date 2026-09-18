import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SessionBackend, SessionSpec } from '@n10/terminal';
import type * as TmuxCli from './tmux-cli.js';

const mock = vi.hoisted(() => ({
  calls: [] as string[],
  taken: new Set<string>(),
  duplicate: new Set<string>(),
  state: { paneDead: false } as { paneDead: boolean; exitCode?: number } | null,
  optionError: '',
  createError: '',
  respawnError: '',
  clientExit: undefined as (() => void) | undefined,
  paneStateCalls: 0,
  /** When true, tmuxPaneStateAsync only resolves once a resolver queued
   *  here is invoked, so a test can hold a poll "in flight". */
  paneStateGated: false,
  paneStateResolvers: [] as (() => void)[],
  /** When true, tmuxPaneStateAsync answers `{ status: 'failed' }` —
   *  n10 could not talk to tmux this tick — regardless of `state`. */
  readFailed: false,
  data: vi.fn(),
  spawn: vi.fn(),
  dispose: vi.fn(),
  write: vi.fn(),
  resize: vi.fn(),
}));
vi.mock('@n10/terminal-pty', () => ({
  PtySession: class {
    pid = 123;
    cols = 80;
    rows = 24;
    constructor(...args: unknown[]) {
      mock.calls.push('attach');
      mock.spawn(...args);
    }
    onExit(cb: () => void) {
      mock.clientExit = cb;
    }
    onData = mock.data;
    offData = vi.fn();
    dispose = mock.dispose;
    write = mock.write;
    resize = mock.resize;
  },
}));
vi.mock('./tmux-cli.js', async (original) => {
  const actual = await original<typeof TmuxCli>();
  const result = (error = '') => ({
    stdout: '',
    stderr: error,
    exitCode: error ? 1 : 0,
  });
  return {
    ...actual,
    tmuxHasSession: (name: string) => mock.taken.has(name),
    tmuxNewSessionDetached: (
      name: string,
      options: TmuxCli.TmuxNewSessionOptions
    ) => {
      mock.calls.push(`create ${name} ${options.command?.join(' ')}`);
      return result(
        mock.duplicate.has(name) ? 'duplicate session' : mock.createError
      );
    },
    tmuxSetOption: (name: string, key: string, value: string) => {
      mock.calls.push(`option ${name} ${key} ${value}`);
      return result(mock.optionError);
    },
    tmuxShowOption: () => '/bin/zsh',
    tmuxKillSession: (name: string) => {
      mock.calls.push(`kill ${name}`);
      return result();
    },
    tmuxPaneState: () => mock.state,
    tmuxPaneStateAsync: () => {
      mock.paneStateCalls += 1;
      const respond = () => {
        if (mock.readFailed) return { status: 'failed' as const };
        if (mock.state == null) return { status: 'gone' as const };
        return { status: 'ok' as const, state: mock.state };
      };
      if (!mock.paneStateGated) return Promise.resolve(respond());
      return new Promise((resolve) => {
        mock.paneStateResolvers.push(() => resolve(respond()));
      });
    },
    tmuxCapturePane: () => 'final output\n',
    runTmux: (args: string[], following: string[][] = []) => {
      mock.calls.push(
        [args, ...following].map((command) => command.join(' ')).join(' ; ')
      );
      return result(mock.optionError || mock.respawnError);
    },
  };
});
import {
  createTmuxBackend,
  setTmuxSessionPreparer,
  type TmuxLaunchPlan,
} from './tmux-backend.js';

const spec: SessionSpec = {
  cmd: '/bin/sh',
  args: ['-c', 'agent'],
  cwd: '/tmp',
  cols: 80,
  rows: 24,
};
const backends: SessionBackend[] = [];
async function launch(
  plan: TmuxLaunchPlan = { mode: 'create', label: 'test', tags: {} },
  overrides: Partial<SessionSpec> = {}
) {
  const backend = await createTmuxBackend({ ...spec, ...overrides }, plan);
  backends.push(backend);
  return backend;
}
beforeEach(() => {
  setTmuxSessionPreparer();
  vi.useFakeTimers();
  mock.calls.length = 0;
  mock.taken.clear();
  mock.duplicate.clear();
  mock.state = { paneDead: false };
  mock.optionError = '';
  mock.createError = '';
  mock.respawnError = '';
  mock.paneStateCalls = 0;
  mock.paneStateGated = false;
  mock.paneStateResolvers.length = 0;
  mock.readFailed = false;
  mock.spawn.mockReset();
  mock.dispose.mockReset();
  mock.data.mockReset();
});
afterEach(() => {
  for (const backend of backends.splice(0)) backend.dispose();
  vi.useRealTimers();
});

describe('explicit tmux launch plans', () => {
  it('installs tags and retention before the real process can exit', async () => {
    await launch({
      mode: 'create',
      label: 'test',
      tags: { '@agent': 'example' },
      retainOnExit: true,
    });
    expect(mock.calls[0]).toBe('create test -- /bin/sh -c exec sleep 86400');
    expect(mock.calls[1]).toMatch(
      /^set-option -t =test: @agent example ; set-option -t =test: remain-on-exit on ; set-option -t =test: status off ; respawn-pane -k -t =test:/
    );
    expect(mock.calls[1]).toContain('-- /bin/sh -c agent');
    expect(mock.calls[2]).toBe('attach');
  });
  // Regression guard for every current (local) user: adding the D5
  // machine-executor seam must not change one byte of what a local
  // launch asks tmux for. Pinned as a literal so a change to argv
  // construction — local or the new remote path sharing its builders —
  // fails loudly here first.
  it('produces byte-for-byte identical argv to today for a local launch', async () => {
    await launch({
      mode: 'create',
      label: 'test',
      tags: {},
      retainOnExit: false,
    });
    expect(mock.calls[0]).toBe('create test -- /bin/sh -c exec sleep 86400');
    // `-e` flags mirror the runner's own PATH/HOME, so only their
    // presence (not the runner's actual values) is pinned here.
    expect(mock.calls[1]).toMatch(
      /^set-option -t =test: remain-on-exit off ; set-option -t =test: status off ; respawn-pane -k -t =test: -c \/tmp( -e \S+=\S+)* -- \/bin\/sh -c agent$/
    );
    expect(mock.calls[2]).toBe('attach');
  });
  it('awaits isolated preparation and attaches to its returned name without rewriting metadata', async () => {
    let prepared!: (name: string) => void;
    setTmuxSessionPreparer(
      () =>
        new Promise((resolve) => {
          prepared = resolve;
        })
    );
    const pending = launch();
    expect(mock.spawn).not.toHaveBeenCalled();
    prepared('isolated-result');
    const backend = await pending;
    expect(backend.name).toBe('isolated-result');
    expect(mock.calls).toEqual(['attach']);
  });
  it('attaches without changing metadata or restarting the process', async () => {
    await launch({ mode: 'attach', target: 'existing' });
    expect(mock.calls).toEqual(['option existing status off', 'attach']);
    expect(mock.spawn.mock.calls[0]?.[1]).toEqual([
      'attach-session',
      '-t',
      '=existing:',
    ]);
  });
  it('leaves occupied names alone and retries concurrent name claims', async () => {
    mock.taken.add('test');
    mock.duplicate.add('test-2');
    const backend = await launch();
    expect(backend.name).toBe('test-3');
    expect(mock.calls.some((call) => call.startsWith('option test '))).toBe(
      false
    );
  });
  it('skips caller-held names and sanitizes labels', async () => {
    const backend = await launch({
      mode: 'create',
      label: 'a.b',
      tags: {},
      excludedNames: ['a-b'],
    });
    expect(backend.name).toBe('a-b-2');
  });
  it('does not clean up someone else’s session when allocation fails', async () => {
    mock.createError = 'permission denied';
    await expect(launch()).rejects.toThrow('permission denied');
    expect(mock.calls.some((call) => call.startsWith('kill'))).toBe(false);
  });
  it.each(['optionError', 'respawnError'] as const)(
    'cleans up its own placeholder on %s',
    async (field) => {
      mock[field] = 'failed';
      await expect(launch()).rejects.toThrow('failed');
      expect(mock.calls.at(-1)).toBe('kill test');
      expect(mock.spawn).not.toHaveBeenCalled();
    }
  );
  it('cleans up a created session if local attachment cannot start', async () => {
    mock.spawn.mockImplementation(() => {
      throw new Error('pty failed');
    });
    await expect(launch()).rejects.toThrow('pty failed');
    expect(mock.calls.at(-1)).toBe('kill test');
  });
  it('preserves existing sessions when local attachment fails', async () => {
    mock.spawn.mockImplementation(() => {
      throw new Error('pty failed');
    });
    await expect(launch({ mode: 'attach', target: 'other' })).rejects.toThrow(
      'pty failed'
    );
    expect(mock.calls.some((call) => call.startsWith('kill'))).toBe(false);
  });
  it('runs the configured login shell when no command is requested', async () => {
    await launch(undefined, { cmd: '', args: [] });
    expect(mock.calls.find((call) => call.includes('respawn-pane'))).toContain(
      '-- /bin/zsh -l'
    );
  });
  it('passes per-launch environment additions to the agent and strips nesting from client env', async () => {
    await launch(undefined, {
      env: { HOME: '/home/example', PATH: '/bin', TMUX: 'nested' },
      envAdditions: { SEED: 'seed' },
    });
    expect(mock.calls.find((call) => call.includes('respawn-pane'))).toContain(
      '-e HOME=/home/example -e SEED=seed'
    );
    expect(mock.spawn.mock.calls[0]?.[2].env).not.toHaveProperty('TMUX');
  });
  it('refuses to restart a live process without touching its metadata', async () => {
    await expect(
      launch({ mode: 'restart', target: 'live', tags: { '@agent': 'new' } })
    ).rejects.toThrow('running or missing');
    expect(mock.calls).toEqual([]);
  });
  it('restarts a dead pane without -k, retaining its identity', async () => {
    mock.state = { paneDead: true, exitCode: 12 };
    await launch({
      mode: 'restart',
      target: 'dead',
      tags: { '@agent': 'new' },
      retainOnExit: true,
    });
    const respawn = mock.calls.find((call) => call.includes('respawn-pane'));
    expect(respawn).toMatch(/^respawn-pane -t =dead:/);
    expect(respawn).not.toContain(' -k ');
  });
});

describe('hosted process lifecycle', () => {
  it('reports retained process exit once, independently of its client', async () => {
    const backend = await launch();
    const exit = vi.fn();
    backend.onExit(exit);
    await vi.advanceTimersByTimeAsync(500);
    mock.state = { paneDead: true, exitCode: 7 };
    await vi.advanceTimersByTimeAsync(1000);
    expect(exit).toHaveBeenCalledExactlyOnceWith(7, undefined);
    expect(backend.processState).toMatchObject({ running: false, exitCode: 7 });
  });
  it('reports dead panes even when attaching after the process exited', async () => {
    mock.state = { paneDead: true, exitCode: 9 };
    const backend = await launch({ mode: 'attach', target: 'dead' });
    const exit = vi.fn();
    backend.onExit(exit);
    await vi.advanceTimersByTimeAsync(1);
    expect(exit).toHaveBeenCalledExactlyOnceWith(9, undefined);
  });
  it('replays retained final output to a late data subscriber before its exit notification', async () => {
    const backend = await launch();
    mock.state = { paneDead: true, exitCode: 4 };
    await vi.advanceTimersByTimeAsync(500);
    const events: string[] = [];
    backend.onData((data) => events.push(data));
    backend.onExit(() => events.push('exit'));
    await vi.advanceTimersByTimeAsync(1);
    expect(events[0]).toContain('final output');
    expect(events[1]).toBe('exit');
  });
  it('notifies remaining exit listeners when the first listener disposes the backend', async () => {
    const backend = await launch();
    const relayExit = vi.fn();
    backend.onExit(() => backend.dispose());
    backend.onExit(relayExit);
    mock.state = { paneDead: true, exitCode: 7 };
    await vi.advanceTimersByTimeAsync(500);
    expect(relayExit).toHaveBeenCalledExactlyOnceWith(7, undefined);
  });
  it('notifies remaining disconnect listeners when the first listener disposes the backend', async () => {
    const backend = await launch();
    const observer = vi.fn();
    backend.onDisconnect?.(() => backend.dispose());
    backend.onDisconnect?.(observer);
    mock.clientExit?.();
    // The client-exit handler awaits an async pane-state read before
    // deciding whether this was a disconnect or an agent exit.
    await vi.advanceTimersByTimeAsync(0);
    expect(observer).toHaveBeenCalledOnce();
  });
  it('distinguishes client disconnect from an agent exit', async () => {
    const backend = await launch();
    const exit = vi.fn();
    const disconnect = vi.fn();
    backend.onExit(exit);
    backend.onDisconnect?.(disconnect);
    mock.clientExit?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(exit).not.toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(backend.processState?.running).toBe(true);
  });
  it('forces a fresh read after client exit rather than reusing a stale in-flight result', async () => {
    mock.paneStateGated = true;
    const backend = await launch();
    // The initial setTimeout(0) inspect starts a read that stays in
    // flight until resolved below — dispatched while the hosted process
    // is still alive, before the client exits.
    await vi.advanceTimersByTimeAsync(1);
    expect(mock.paneStateCalls).toBe(1);
    const exit = vi.fn();
    const disconnect = vi.fn();
    backend.onExit(exit);
    backend.onDisconnect?.(disconnect);
    mock.clientExit?.();
    await vi.advanceTimersByTimeAsync(0);
    // onExit must wait for the stale read rather than starting a
    // second one right away.
    expect(mock.paneStateCalls).toBe(1);
    // The stale read resolves with the state as of when it was issued
    // — still alive — which must not be trusted for this decision.
    mock.paneStateResolvers.shift()?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(mock.paneStateCalls).toBe(2);
    expect(exit).not.toHaveBeenCalled();
    expect(disconnect).not.toHaveBeenCalled();
    // The hosted process has since exited; the fresh read reflects that.
    mock.state = { paneDead: true, exitCode: 9 };
    mock.paneStateResolvers.shift()?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(exit).toHaveBeenCalledExactlyOnceWith(9, undefined);
    expect(disconnect).not.toHaveBeenCalled();
  });
  it('reconnects locally with the same size and data subscribers', async () => {
    const backend = await launch();
    const data = vi.fn();
    backend.onData(data);
    backend.resize(100, 40);
    mock.clientExit?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(backend.connectionState).toBe('reconnecting');
    await vi.advanceTimersByTimeAsync(500);
    expect(backend.connectionState).toBe('connected');
    expect(mock.spawn).toHaveBeenCalledTimes(2);
    expect(mock.spawn.mock.calls[1]?.[2]).toMatchObject({
      cols: 100,
      rows: 40,
    });
    expect(mock.data).toHaveBeenCalledTimes(2);
    expect(mock.data).toHaveBeenLastCalledWith(data);
    expect(backend.processState?.running).toBe(true);
  });
  it('bounds failed client reconnection attempts and cancels them on disposal', async () => {
    const backend = await launch();
    mock.spawn.mockImplementation(() => {
      throw new Error('unavailable');
    });
    mock.clientExit?.();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mock.spawn).toHaveBeenCalledTimes(4);
    expect(backend.connectionState).toBe('failed');
    expect(backend.processState?.running).toBe(true);
    backend.dispose();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mock.spawn).toHaveBeenCalledTimes(4);
  });
  it('cancels an upcoming reconnect when disposed', async () => {
    const backend = await launch();
    mock.clientExit?.();
    backend.dispose();
    await vi.advanceTimersByTimeAsync(2000);
    expect(mock.spawn).toHaveBeenCalledOnce();
  });
  // Finding 10: closing n10 (or switching a tab away) is a deliberate
  // detach, not a connection failure. Disposing a healthy connection
  // must not leave connectionState reading 'failed' — that specifically
  // means "reconnection was attempted and gave up".
  it('does not report connectionState as failed after a deliberate dispose while healthy', async () => {
    const backend = await launch();
    expect(backend.connectionState).toBe('connected');
    backend.dispose();
    expect(backend.connectionState).not.toBe('failed');
  });
  it('stops polling and emitting after disposal without killing the process', async () => {
    const backend = await launch();
    const exit = vi.fn();
    backend.onExit(exit);
    backend.dispose();
    mock.state = { paneDead: true };
    await vi.advanceTimersByTimeAsync(1500);
    mock.clientExit?.();
    expect(exit).not.toHaveBeenCalled();
    expect(mock.calls.some((call) => call.startsWith('kill'))).toBe(false);
    expect(mock.dispose).toHaveBeenCalledOnce();
  });
  it('does not stack a poll while the previous pane-state read is still in flight', async () => {
    mock.paneStateGated = true;
    await launch();
    // The initial setTimeout(0) inspect starts a read that never resolves
    // until we let it.
    await vi.advanceTimersByTimeAsync(1);
    expect(mock.paneStateCalls).toBe(1);
    // Two more 500ms ticks land while that read is still pending; neither
    // should start a second, overlapping tmux read.
    await vi.advanceTimersByTimeAsync(1000);
    expect(mock.paneStateCalls).toBe(1);
    // Resolving it clears the in-flight guard, so the next tick reads again.
    mock.paneStateResolvers.shift()?.();
    await vi.advanceTimersByTimeAsync(500);
    expect(mock.paneStateCalls).toBe(2);
  });
  it('does not conclude exit on a failed pane-state read, and recovers on the next healthy tick', async () => {
    // A non-zero exit or spawn error (EAGAIN/EMFILE on fork, ENOENT, the
    // 5s timeout kill) says nothing about the pane; it must not be
    // reported as the hosted process exiting.
    const backend = await launch();
    const exit = vi.fn();
    backend.onExit(exit);
    await vi.advanceTimersByTimeAsync(1);
    mock.readFailed = true;
    await vi.advanceTimersByTimeAsync(500);
    expect(exit).not.toHaveBeenCalled();
    expect(backend.processState?.running).toBe(true);
    mock.readFailed = false;
    mock.state = { paneDead: true, exitCode: 3 };
    await vi.advanceTimersByTimeAsync(500);
    expect(exit).toHaveBeenCalledExactlyOnceWith(3, undefined);
  });
  it('drops a pane-state read that resolves after dispose, firing no callbacks', async () => {
    mock.paneStateGated = true;
    const backend = await launch();
    const exit = vi.fn();
    backend.onExit(exit);
    // The initial setTimeout(0) inspect starts a read that stays in
    // flight until we resolve it below.
    await vi.advanceTimersByTimeAsync(1);
    backend.dispose();
    mock.state = { paneDead: true, exitCode: 5 };
    mock.paneStateResolvers.shift()?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(exit).not.toHaveBeenCalled();
  });
  it('kills only the resolved target, once', async () => {
    const backend = await launch({ mode: 'attach', target: 'actual' });
    backend.kill();
    backend.kill();
    expect(mock.calls.filter((call) => call.startsWith('kill'))).toEqual([
      'kill actual',
    ]);
    expect(mock.dispose).toHaveBeenCalledOnce();
  });
});
