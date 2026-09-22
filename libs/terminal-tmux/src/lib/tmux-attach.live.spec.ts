/**
 * Attaching, detaching and re-attaching, against a real tmux server.
 *
 * The rest of the suite covers what a session *is* (creation, tags,
 * restart, exit). This file covers the client on the near side of it:
 * a tmux session outlives every client that ever attached to it, so
 * losing one — the user pressing `C-b d`, a killed client, a link that
 * dropped — must cost the pane nothing. What tmux guarantees here is
 * the pane and its process; what n10 has to get right is coming back
 * to them, at the size it last had, without disturbing anyone else who
 * is looking at the same session.
 *
 * `vitest.setup.ts` pins `TMUX_TMPDIR` and drops `$TMUX`, so none of
 * this can reach the developer's own server. Skipped where tmux is not
 * installed, as the other live suites are.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import type { SessionBackend, SessionSpec } from '@n10/terminal';
import { PtySession } from '@n10/terminal-pty';
import { assertScratchTmuxSocket } from '../../vitest.setup.js';
import { createTmuxBackend } from './tmux-backend.js';
import { tmuxHasSession, tmuxKillSession } from './tmux-cli.js';

function tmuxAvailable(): boolean {
  try {
    execFileSync('tmux', ['-V'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
const SKIP = !tmuxAvailable();

/** Real tmux forks, a real pty and a 500ms poll behind every wait here,
 *  on a box that may be running the rest of the suite beside it. */
const SETTLE_MS = 15_000;

const backends: SessionBackend[] = [];
const extraClients: PtySession[] = [];

function uniqueName(suffix: string): string {
  return `tmuxlib-attach-${process.pid}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}-${suffix}`;
}

function spec(
  command: string,
  cols = 80,
  rows = 24
): SessionSpec & { name: string } {
  return {
    name: uniqueName('s'),
    cmd: '/bin/sh',
    args: ['-c', command],
    cwd: process.cwd(),
    cols,
    rows,
  };
}

async function retained(
  command: string,
  cols?: number,
  rows?: number
): Promise<SessionBackend> {
  const request = spec(command, cols, rows);
  const backend = await createTmuxBackend(request, {
    mode: 'create',
    label: request.name,
    tags: { '@test-agent': 'first' },
    retainOnExit: true,
  });
  backends.push(backend);
  return backend;
}

/** One `display-message` format, read off the session's active pane. */
function display(name: string, format: string): string {
  return execFileSync(
    'tmux',
    ['-u', 'display-message', '-p', '-t', `=${name}:`, format],
    { encoding: 'utf8' }
  ).trim();
}

/** The pids of the tmux clients currently attached. Empty while none
 *  is: `list-clients` for a session nobody is watching succeeds with no
 *  output. */
function clientPids(name: string): string[] {
  return execFileSync(
    'tmux',
    ['list-clients', '-t', `=${name}:`, '-F', '#{client_pid}'],
    { encoding: 'utf8' }
  )
    .trim()
    .split('\n')
    .filter(Boolean);
}

/** What the detach key does, from outside. */
function detachAll(name: string): void {
  execFileSync('tmux', ['detach-client', '-s', `=${name}:`]);
}

/** Wait for exactly one client, none of them one of `previous`. */
async function expectReplacementClient(
  name: string,
  previous: readonly string[]
): Promise<void> {
  await vi.waitFor(
    () => {
      const now = clientPids(name);
      expect(now).toHaveLength(1);
      expect(previous).not.toContain(now[0]);
    },
    { timeout: SETTLE_MS }
  );
}

beforeAll(assertScratchTmuxSocket);
afterEach(() => {
  for (const client of extraClients.splice(0)) client.dispose();
  for (const backend of backends.splice(0)) backend.kill();
});

describe.skipIf(SKIP)('attaching, detaching and re-attaching', () => {
  it('keeps the pane, its process and its scrollback across a detach', async () => {
    const backend = await retained("printf 'scrollback-marker\\n'; sleep 30");
    const name = backend.name!;
    let seen = '';
    backend.onData((data) => {
      seen += data;
    });
    await vi.waitFor(() => expect(seen).toContain('scrollback-marker'), {
      timeout: SETTLE_MS,
    });
    const panePid = display(name, '#{pane_pid}');
    const before = clientPids(name);
    expect(before).toHaveLength(1);

    // Everything asserted below has to be produced *after* the detach,
    // so what the first client already delivered cannot stand in for it.
    seen = '';
    detachAll(name);
    await expectReplacementClient(name, before);

    // tmux repaints a pane for a client that attaches to it, so the
    // replacement is handed the same screen rather than a blank one.
    await vi.waitFor(() => expect(seen).toContain('scrollback-marker'), {
      timeout: SETTLE_MS,
    });
    // …and it is the same process behind it. A session torn down and
    // recreated under the same name would satisfy everything above.
    expect(display(name, '#{pane_pid}')).toBe(panePid);
    expect(backend.processState?.running).toBe(true);
    expect(backend.connectionState).toBe('connected');
  });

  it('re-attaches after its client was killed, and the session still takes input', async () => {
    const backend = await retained('cat');
    const name = backend.name!;
    const exit = vi.fn();
    const disconnect = vi.fn();
    backend.onExit(exit);
    backend.onDisconnect?.(disconnect);
    let seen = '';
    backend.onData((data) => {
      seen += data;
    });
    await vi.waitFor(() => expect(clientPids(name)).toHaveLength(1), {
      timeout: SETTLE_MS,
    });
    const before = clientPids(name);

    // Not a detach: the client process dies where it stands, which is
    // what a crashed or reaped client looks like to the session.
    process.kill(backend.pid, 'SIGKILL');
    await vi.waitFor(() => expect(disconnect).toHaveBeenCalled(), {
      timeout: SETTLE_MS,
    });
    // A client ending is not the agent ending.
    expect(exit).not.toHaveBeenCalled();
    await expectReplacementClient(name, before);
    await vi.waitFor(() => expect(backend.connectionState).toBe('connected'), {
      timeout: SETTLE_MS,
    });

    seen = '';
    backend.write('still-here-42\n');
    await vi.waitFor(() => expect(seen).toContain('still-here-42'), {
      timeout: SETTLE_MS,
    });
    expect(backend.processState?.running).toBe(true);
  });

  it('gives the client that re-attaches the size set while none was attached', async () => {
    const backend = await retained('sleep 30', 80, 24);
    const name = backend.name!;
    await vi.waitFor(() => expect(clientPids(name)).toHaveLength(1), {
      timeout: SETTLE_MS,
    });
    const before = clientPids(name);
    detachAll(name);

    // The window with no client is the reconnect backoff — short, and
    // polled for rather than assumed. The deterministic cover for a
    // resize landing in it is in tmux-backend.spec.ts; what this adds
    // is that node-pty really does refuse a departed client, and that
    // the size survives to the one that replaces it.
    await vi.waitFor(() => expect(clientPids(name)).toHaveLength(0), {
      timeout: SETTLE_MS,
    });
    expect(() => backend.resize(100, 40)).not.toThrow();

    await expectReplacementClient(name, before);
    await vi.waitFor(
      () =>
        expect(display(name, '#{pane_width}x#{pane_height}')).toBe('100x40'),
      { timeout: SETTLE_MS }
    );
    expect([backend.cols, backend.rows]).toEqual([100, 40]);
  });

  it('joins a session someone else is watching instead of throwing them off', async () => {
    const backend = await retained('sleep 30', 80, 24);
    const name = backend.name!;
    const exit = vi.fn();
    backend.onExit(exit);
    await vi.waitFor(() => expect(clientPids(name)).toHaveLength(1), {
      timeout: SETTLE_MS,
    });

    // Somebody's own terminal, on the same session, at another size.
    const foreign = new PtySession(
      'tmux',
      ['attach-session', '-t', `=${name}:`],
      {
        cols: 120,
        rows: 40,
      }
    );
    extraClients.push(foreign);
    await vi.waitFor(() => expect(clientPids(name)).toHaveLength(2), {
      timeout: SETTLE_MS,
    });
    const watching = clientPids(name);

    // n10 attaching again — a second window on the same agent — makes
    // three. `attach-session` without `-d` is what keeps it additive;
    // with it, the two above would be gone.
    const second = await createTmuxBackend(spec('should-not-run'), {
      mode: 'attach',
      target: name,
    });
    backends.push(second);
    await vi.waitFor(
      () => {
        const now = clientPids(name);
        expect(now).toHaveLength(3);
        for (const pid of watching) expect(now).toContain(pid);
      },
      { timeout: SETTLE_MS }
    );
    // Nobody's arrival ended the agent, whatever size they came at.
    expect(exit).not.toHaveBeenCalled();
    expect(backend.processState?.running).toBe(true);
  });

  it('refuses to attach to a session that vanished after it was listed', async () => {
    const backend = await retained('sleep 30');
    const name = backend.name!;
    expect(tmuxHasSession(name)).toBe(true);
    backend.dispose();
    tmuxKillSession(name);

    // A launcher that resolved this target a moment ago must be told,
    // rather than handed a backend that reports a running agent nobody
    // can reach — or one that quietly creates a session in its place.
    await expect(
      createTmuxBackend(spec('should-not-run'), {
        mode: 'attach',
        target: name,
      })
    ).rejects.toThrow();
    expect(tmuxHasSession(name)).toBe(false);
  });

  it('hands a late subscriber the retained final frame before its exit', async () => {
    const backend = await retained("printf 'last-frame-marker\\n'; exit 3");
    await vi.waitFor(() => expect(backend.processState?.running).toBe(false), {
      timeout: SETTLE_MS,
    });

    // Subscribing after the agent is already gone: the pane the user
    // opens is a tab that was never on screen while it ran.
    const order: string[] = [];
    backend.onData((data) => {
      if (data.includes('last-frame-marker')) order.push('frame');
    });
    backend.onExit((code) => order.push(`exit:${code}`));
    await vi.waitFor(() => expect(order).toContain('exit:3'), {
      timeout: SETTLE_MS,
    });
    // The frame first: a listener that tears the terminal down on exit
    // would otherwise never see what the agent left behind.
    expect(order[0]).toBe('frame');
  });
});
