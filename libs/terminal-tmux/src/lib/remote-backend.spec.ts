import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { SessionSpec } from '@n10/terminal';
import {
  createRemoteTmuxBackend,
  type RemoteMachine,
  type RemotePtyHandle,
} from './remote-backend.js';
import { RemoteSessionPoller } from './remote-poller.js';
import type { MachineExecutor } from './tmux-cli.js';

const spec: SessionSpec = {
  cmd: '/bin/sh',
  args: ['-c', 'agent'],
  cwd: '/tmp',
  cols: 80,
  rows: 24,
};

/** A fake pty stream: records write/resize, lets the test push data and
 *  close the stream, and counts how many times it was opened. */
function fakeHandle() {
  const dataCbs = new Set<(d: string) => void>();
  const closeCbs = new Set<() => void>();
  const handle: RemotePtyHandle = {
    onData: (cb) => dataCbs.add(cb),
    offData: (cb) => dataCbs.delete(cb),
    write: vi.fn(),
    resize: vi.fn(),
    onClose: (cb) => closeCbs.add(cb),
    dispose: vi.fn(),
  };
  return {
    handle,
    push: (data: string) => dataCbs.forEach((cb) => cb(data)),
    close: () => closeCbs.forEach((cb) => cb()),
  };
}

/** Flushes microtasks (the immediate first poll, a reconnect's promise
 *  chain, …) without advancing fake timers — which would also fire the
 *  poller's own interval and complicate the timeline being asserted. */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

/** A `list-sessions -F …` reply reporting one alive, non-dead session —
 *  the poller's default "still running" answer so tests that are not
 *  specifically about exit/unreachable behaviour do not accidentally
 *  race their own backend into "exited" via the poller's immediate
 *  first poll. */
function aliveListing(...names: string[]): {
  stdout: string;
  stderr: string;
  code: number;
} {
  return {
    stdout: names.map((name) => `${name}\t1\t0\t\t\t/tmp`).join('\n'),
    stderr: '',
    code: 0,
  };
}

describe('RemoteTmuxBackend (D4)', () => {
  let opens: ReturnType<typeof fakeHandle>[];
  let run: ReturnType<typeof vi.fn<MachineExecutor['run']>>;
  let machine: RemoteMachine;
  let poller: RemoteSessionPoller;

  beforeEach(() => {
    vi.useFakeTimers();
    opens = [];
    run = vi.fn().mockResolvedValue({ stdout: '', stderr: '', code: 0 });
    const executor: MachineExecutor = { run };
    poller = new RemoteSessionPoller(executor, 1000);
    machine = {
      id: 'peer-1',
      executor,
      ptyOpener: {
        open: vi.fn(async () => {
          const opened = fakeHandle();
          opens.push(opened);
          return opened.handle;
        }),
      },
    };
  });
  afterEach(() => {
    poller.dispose();
    vi.useRealTimers();
  });

  it('constructs over an already-created session name and attaches a pty stream with the expected argv', async () => {
    run.mockImplementation(async (argv: string[]) => {
      if (argv.includes('has-session'))
        return { stdout: '', stderr: '', code: 1 };
      if (argv.includes('list-sessions')) return aliveListing('wt');
      return { stdout: '', stderr: '', code: 0 };
    });
    await createRemoteTmuxBackend(
      spec,
      { mode: 'create', label: 'wt', tags: {} },
      machine,
      poller
    );
    expect(machine.ptyOpener.open).toHaveBeenCalledTimes(1);
    const params = (machine.ptyOpener.open as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(params.argv).toEqual(['tmux', 'attach-session', '-t', '=wt:']);
    expect(params.cwd).toBe('/tmp');
  });

  it('a dropped connection sets connectionState to reconnecting and leaves processState.running true', async () => {
    run.mockImplementation(async (argv: string[]) => {
      if (argv.includes('has-session'))
        return { stdout: '', stderr: '', code: 1 };
      if (argv.includes('list-sessions')) return aliveListing('wt');
      return { stdout: '', stderr: '', code: 0 };
    });
    const backend = await createRemoteTmuxBackend(
      spec,
      { mode: 'create', label: 'wt', tags: {} },
      machine,
      poller
    );
    expect(backend.connectionState).toBe('connected');
    opens[0]!.close();
    expect(backend.connectionState).toBe('reconnecting');
    expect(backend.processState?.running).toBe(true);
  });

  it('an agent exiting (reported by the poller) sets processState and does not touch connectionState', async () => {
    run.mockImplementation(async (argv: string[]) => {
      if (argv.includes('has-session'))
        return { stdout: '', stderr: '', code: 1 };
      if (argv.includes('list-sessions'))
        // Not listed any more: the session ended.
        return { stdout: '', stderr: '', code: 0 };
      if (argv.includes('capture-pane'))
        return { stdout: 'final\n', stderr: '', code: 0 };
      return { stdout: '', stderr: '', code: 0 };
    });
    const backend = await createRemoteTmuxBackend(
      spec,
      { mode: 'create', label: 'wt', tags: {} },
      machine,
      poller
    );
    const exited = vi.fn();
    backend.onExit(exited);
    await flushMicrotasks();
    expect(backend.processState?.running).toBe(false);
    expect(backend.connectionState).toBe('connected');
    expect(exited).toHaveBeenCalled();
  });

  it('dispose() detaches locally without killing the remote session; kill() runs kill-session first', async () => {
    run.mockImplementation(async (argv: string[]) => {
      if (argv.includes('has-session'))
        return { stdout: '', stderr: '', code: 1 };
      if (argv.includes('list-sessions')) return aliveListing('wt', 'wt2');
      return { stdout: '', stderr: '', code: 0 };
    });
    const backend = await createRemoteTmuxBackend(
      spec,
      { mode: 'create', label: 'wt', tags: {} },
      machine,
      poller
    );
    run.mockClear();
    backend.dispose();
    expect(run).not.toHaveBeenCalledWith(
      expect.arrayContaining(['tmux', 'kill-session', '-t', '=wt:'])
    );
    expect(opens[0]!.handle.dispose).toHaveBeenCalled();

    opens.length = 0;
    const backend2 = await createRemoteTmuxBackend(
      spec,
      { mode: 'create', label: 'wt2', tags: {} },
      machine,
      poller
    );
    run.mockClear();
    backend2.kill();
    expect(run).toHaveBeenCalledWith(['tmux', 'kill-session', '-t', '=wt2:']);
  });

  // Finding 10: closing n10 (or switching a tab away) is a deliberate
  // detach, not a connection failure. Disposing a healthy connection
  // must not leave connectionState reading 'failed'.
  it('does not report connectionState as failed after a deliberate dispose while healthy', async () => {
    run.mockImplementation(async (argv: string[]) => {
      if (argv.includes('has-session'))
        return { stdout: '', stderr: '', code: 1 };
      if (argv.includes('list-sessions')) return aliveListing('wt');
      return { stdout: '', stderr: '', code: 0 };
    });
    const backend = await createRemoteTmuxBackend(
      spec,
      { mode: 'create', label: 'wt', tags: {} },
      machine,
      poller
    );
    expect(backend.connectionState).toBe('connected');
    backend.dispose();
    expect(backend.connectionState).not.toBe('failed');
  });

  it('replays the screen with capture-pane on re-attach after a drop', async () => {
    run.mockImplementation(async (argv: string[]) => {
      if (argv.includes('has-session'))
        return { stdout: '', stderr: '', code: 1 };
      if (argv.includes('list-sessions')) return aliveListing('wt');
      if (argv.includes('capture-pane'))
        return { stdout: 'replayed screen\n', stderr: '', code: 0 };
      return { stdout: '', stderr: '', code: 0 };
    });
    const backend = await createRemoteTmuxBackend(
      spec,
      { mode: 'create', label: 'wt', tags: {} },
      machine,
      poller
    );
    const chunks: string[] = [];
    backend.onData((d) => chunks.push(d));
    opens[0]!.close();
    expect(backend.connectionState).toBe('reconnecting');
    await vi.advanceTimersByTimeAsync(500);
    await flushMicrotasks();
    expect(backend.connectionState).toBe('connected');
    expect(opens).toHaveLength(2);
    expect(chunks.some((c) => c.includes('replayed screen'))).toBe(true);
  });

  it('reconnect() retries immediately after automatic reconnection has given up', async () => {
    let opensAttempted = 0;
    run.mockImplementation(async (argv: string[]) => {
      if (argv.includes('has-session'))
        return { stdout: '', stderr: '', code: 1 };
      if (argv.includes('list-sessions')) return aliveListing('wt');
      return { stdout: '', stderr: '', code: 0 };
    });
    machine.ptyOpener.open = vi.fn(async () => {
      opensAttempted += 1;
      // The initial attach (1) succeeds; every automatic retry (2-4,
      // exhausting the bounded 3 attempts) fails; the manual retry (5)
      // succeeds again.
      if (opensAttempted >= 2 && opensAttempted <= 4) {
        throw new Error('still unreachable');
      }
      const opened = fakeHandle();
      opens.push(opened);
      return opened.handle;
    });
    const backend = await createRemoteTmuxBackend(
      spec,
      { mode: 'create', label: 'wt', tags: {} },
      machine,
      poller
    );
    opens[0]!.close();
    expect(backend.connectionState).toBe('reconnecting');
    // Exhaust the bounded automatic backoff (500ms, 1000ms, 2000ms).
    await vi.advanceTimersByTimeAsync(500);
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(1000);
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(2000);
    await flushMicrotasks();
    expect(backend.connectionState).toBe('failed');
    expect(opensAttempted).toBe(4);

    // The manual retry: no more backoff, tries right away.
    backend.reconnect?.();
    expect(backend.connectionState).toBe('reconnecting');
    await flushMicrotasks();
    expect(backend.connectionState).toBe('connected');
    expect(opensAttempted).toBe(5);
  });

  // `dispose()` can only clear a *scheduled* retry. One already
  // awaiting `open()` resolves onto a backend whose handle, callbacks
  // and poll subscription are gone; adopting that handle leaks the
  // remote pty stream, because nothing else holds a reference to it.
  it('disposes a stream that finishes opening after dispose(), instead of adopting it on a torn-down backend', async () => {
    run.mockImplementation(async (argv: string[]) => {
      if (argv.includes('has-session'))
        return { stdout: '', stderr: '', code: 1 };
      if (argv.includes('list-sessions')) return aliveListing('wt');
      return { stdout: '', stderr: '', code: 0 };
    });
    let releaseOpen: () => void = () => undefined;
    const pendingOpen = new Promise<void>((resolve) => {
      releaseOpen = resolve;
    });
    let attempted = 0;
    machine.ptyOpener.open = vi.fn(async () => {
      attempted += 1;
      const opened = fakeHandle();
      opens.push(opened);
      // The initial attach resolves at once; the reconnect hangs until
      // the test releases it, so dispose() lands mid-flight.
      if (attempted > 1) await pendingOpen;
      return opened.handle;
    });
    const backend = await createRemoteTmuxBackend(
      spec,
      { mode: 'create', label: 'wt', tags: {} },
      machine,
      poller
    );
    opens[0]!.close();
    await vi.advanceTimersByTimeAsync(500);
    expect(opens).toHaveLength(2);

    backend.dispose();
    releaseOpen();
    await flushMicrotasks();
    expect(opens[1]!.handle.dispose).toHaveBeenCalled();
    expect(backend.connectionState).not.toBe('connected');
  });

  it('reconnect() is a no-op while already connected', async () => {
    run.mockImplementation(async (argv: string[]) => {
      if (argv.includes('has-session'))
        return { stdout: '', stderr: '', code: 1 };
      if (argv.includes('list-sessions')) return aliveListing('wt');
      return { stdout: '', stderr: '', code: 0 };
    });
    const backend = await createRemoteTmuxBackend(
      spec,
      { mode: 'create', label: 'wt', tags: {} },
      machine,
      poller
    );
    expect(backend.connectionState).toBe('connected');
    backend.reconnect?.();
    expect(backend.connectionState).toBe('connected');
    expect(machine.ptyOpener.open).toHaveBeenCalledTimes(1);
  });

  it('a machine going unreachable marks its backend reconnecting rather than exited', async () => {
    run.mockImplementation(async (argv: string[]) => {
      if (argv.includes('has-session'))
        return { stdout: '', stderr: '', code: 1 };
      if (argv.includes('list-sessions')) throw new Error('connection lost');
      return { stdout: '', stderr: '', code: 0 };
    });
    const backend = await createRemoteTmuxBackend(
      spec,
      { mode: 'create', label: 'wt', tags: {} },
      machine,
      poller
    );
    await flushMicrotasks();
    // Second-pass finding 7: the poller now waits for a second
    // consecutive failed poll before reporting unreachable, so a
    // single control-plane blip does not churn a healthy data plane.
    await vi.advanceTimersByTimeAsync(1000);
    expect(backend.connectionState).toBe('reconnecting');
    expect(backend.processState?.running).toBe(true);
  });

  // Finding 3: tmux missing on the remote, a socket permission error, or
  // an exec handler returning non-zero must never read as "the agent
  // exited" — only a thrown error (a call that could not run at all)
  // may. `run` resolving with a non-zero `code` (as opposed to
  // rejecting) is exactly the case that used to slip through:
  // `tmuxListSessionsDetailedWith` turned it into an empty list, which
  // the poller then read as "session gone".
  it('a non-zero exit from list-sessions (not a thrown error) also marks the backend reconnecting, never exited', async () => {
    run.mockImplementation(async (argv: string[]) => {
      if (argv.includes('has-session'))
        return { stdout: '', stderr: '', code: 1 };
      if (argv.includes('list-sessions'))
        return { stdout: '', stderr: 'tmux: command not found', code: 127 };
      return { stdout: '', stderr: '', code: 0 };
    });
    const backend = await createRemoteTmuxBackend(
      spec,
      { mode: 'create', label: 'wt', tags: {} },
      machine,
      poller
    );
    const exited = vi.fn();
    backend.onExit(exited);
    await flushMicrotasks();
    // Second-pass finding 7: wait for the poller's second consecutive
    // failed poll, same as the test above.
    await vi.advanceTimersByTimeAsync(1000);
    expect(backend.connectionState).toBe('reconnecting');
    expect(backend.processState?.running).toBe(true);
    expect(exited).not.toHaveBeenCalled();
  });

  // The other half of the same distinction: a *successful* call that
  // genuinely lists nothing for this session (exit 0, no matching row)
  // must still mean the session is gone — matched here against the
  // 127/non-zero case above so a fix cannot solve one by breaking the
  // other (e.g. treating every non-zero-or-empty result as a failure).
  // Finding 4: both `kill()` and `handlePollState`'s replay wrap a
  // promise that rejects on any transport failure in a bare `void`,
  // which does not catch anything — on a flaky machine that is a
  // process-level unhandled rejection in Electron main over an
  // entirely routine failure.
  it('kill() does not produce an unhandled rejection when the remote kill-session call fails', async () => {
    run.mockImplementation(async (argv: string[]) => {
      if (argv.includes('has-session'))
        return { stdout: '', stderr: '', code: 1 };
      if (argv.includes('list-sessions')) return aliveListing('wt');
      if (argv.includes('kill-session')) throw new Error('connection reset');
      return { stdout: '', stderr: '', code: 0 };
    });
    const backend = await createRemoteTmuxBackend(
      spec,
      { mode: 'create', label: 'wt', tags: {} },
      machine,
      poller
    );
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      backend.kill();
      await flushMicrotasks();
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('replaying the final frame on exit does not produce an unhandled rejection when capture-pane fails', async () => {
    run.mockImplementation(async (argv: string[]) => {
      if (argv.includes('has-session'))
        return { stdout: '', stderr: '', code: 1 };
      if (argv.includes('list-sessions'))
        // Still found, but its pane is dead — handlePollState takes the
        // "info.found" branch and tries to replay the final frame.
        return {
          stdout: 'wt\t1\t1\t0\t\t/tmp',
          stderr: '',
          code: 0,
        };
      if (argv.includes('capture-pane')) throw new Error('connection reset');
      return { stdout: '', stderr: '', code: 0 };
    });
    const backend = await createRemoteTmuxBackend(
      spec,
      { mode: 'create', label: 'wt', tags: {} },
      machine,
      poller
    );
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      backend.onExit(() => undefined);
      await flushMicrotasks();
      expect(backend.processState?.running).toBe(false);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('a genuinely empty listing (exit 0, session not present) still means the session exited', async () => {
    run.mockImplementation(async (argv: string[]) => {
      if (argv.includes('has-session'))
        return { stdout: '', stderr: '', code: 1 };
      if (argv.includes('list-sessions'))
        return { stdout: '', stderr: '', code: 0 };
      if (argv.includes('capture-pane'))
        return { stdout: 'final\n', stderr: '', code: 0 };
      return { stdout: '', stderr: '', code: 0 };
    });
    const backend = await createRemoteTmuxBackend(
      spec,
      { mode: 'create', label: 'wt', tags: {} },
      machine,
      poller
    );
    const exited = vi.fn();
    backend.onExit(exited);
    await flushMicrotasks();
    expect(backend.processState?.running).toBe(false);
    expect(backend.connectionState).toBe('connected');
    expect(exited).toHaveBeenCalled();
  });
});
