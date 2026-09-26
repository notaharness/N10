import { worktreeSessionKey, terminalSessionKey } from '../session-key.js';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { WorktreeInfo } from '@n10/worktree-manager';
import type {
  DiscoveredTerminal,
  DiscoveredWorktree,
} from './discovery-model.js';

const {
  listWorktreesMock,
  listPersistedMock,
  listTerminalsMock,
  isSessionAliveMock,
  sessionNamesMock,
  watchMock,
  basePathMock,
} = vi.hoisted(() => ({
  listWorktreesMock: vi.fn<() => Promise<WorktreeInfo[]>>(),
  listPersistedMock: vi.fn<() => Set<string>>(),
  listTerminalsMock: vi.fn<() => DiscoveredTerminal[]>(),
  isSessionAliveMock: vi.fn<(name: string) => boolean>(),
  sessionNamesMock: vi.fn<() => string[]>(),
  watchMock: vi.fn(),
  basePathMock: vi.fn<() => string>(),
}));

vi.mock('node:fs', () => ({
  watch: (...args: unknown[]) => watchMock(...args),
}));
vi.mock('@n10/logger', () => ({
  log: () => undefined,
  logError: () => undefined,
}));
vi.mock('@n10/worktree-manager', () => ({
  listWorktrees: () => listWorktreesMock(),
  // The real rule, not `wt.branch`: a detached-HEAD worktree has no
  // branch and is named after its directory. Stubbing it as the branch
  // would let the scanner collapse every orphan onto the empty string
  // and no test would notice.
  worktreeSessionName: (wt: WorktreeInfo) =>
    wt.branch || wt.path.split('/').pop(),
  worktreesBasePath: () => basePathMock(),
}));
vi.mock('../pty-registry.js', () => ({
  sessionNames: () => sessionNamesMock(),
  hasSessionConnection: (name: string) => isSessionAliveMock(name),
  isSessionAlive: (name: string) => isSessionAliveMock(name),
}));
vi.mock('../session-backend.js', () => ({
  observeTmuxSessions: () => ({
    persisted: listPersistedMock(),
    terminals: listTerminalsMock(),
  }),
}));

vi.mock('../repo-root.js', () => ({ getRepoRoot: () => '/repo' }));

import { startSessionDiscovery } from './session-discovery.js';

/** The registry key of the worktree checked out in directory `dir`. */
const wtKey = (dir: string) =>
  worktreeSessionKey(`/repo/.claude/worktrees/${dir}`);

function worktrees(...branches: string[]): WorktreeInfo[] {
  return branches.map((branch) => ({
    branch,
    path: `/repo/.claude/worktrees/${branch}`,
    bare: false,
  }));
}

/** A watcher stand-in that hands back the change callback so a test can
 *  fire it the way the filesystem would. */
function captureWatcher() {
  const handle = { close: vi.fn(), on: vi.fn() };
  let fire: (() => void) | undefined;
  watchMock.mockImplementation(
    (_path: unknown, _opts: unknown, cb: () => void) => {
      fire = cb;
      return handle;
    }
  );
  return { handle, trigger: () => fire?.() };
}

let running: { stop(): void } | null = null;
/** Stands in for the PTY registry: the default `adopt` puts a name in
 *  here, which is what a real attach does by spawning into it. Without
 *  that, every scan would keep re-offering a session it just attached
 *  to — and the tests would be asserting against a world that cannot
 *  happen. */
let alive: Set<string>;

beforeEach(() => {
  vi.useFakeTimers();
  alive = new Set();
  sessionNamesMock.mockReset().mockReturnValue([]);
  listWorktreesMock.mockReset().mockResolvedValue([]);
  listPersistedMock.mockReset().mockReturnValue(new Set());
  listTerminalsMock.mockReset().mockReturnValue([]);
  isSessionAliveMock.mockReset().mockImplementation((name) => alive.has(name));
  basePathMock.mockReset().mockReturnValue('/repo/.claude/worktrees');
  watchMock.mockReset().mockReturnValue({ close: vi.fn(), on: vi.fn() });
});

afterEach(() => {
  running?.stop();
  running = null;
  vi.useRealTimers();
});

function start(
  over: Partial<Parameters<typeof startSessionDiscovery>[0]> = {}
) {
  const adopt = vi.fn<(wt: DiscoveredWorktree) => void | Promise<void>>(
    (wt) => {
      alive.add(wt.name);
    }
  );
  const adoptTerminal = vi.fn<(t: DiscoveredTerminal) => void | Promise<void>>(
    (t) => {
      alive.add(t.name);
    }
  );
  const onChanged = vi.fn();
  const discovery = startSessionDiscovery({
    adopt,
    adoptTerminal,
    onChanged,
    intervalMs: 1000,
    ...over,
  });
  running = discovery;
  return { discovery, adopt, adoptTerminal, onChanged };
}

const shellTerm: DiscoveredTerminal = {
  name: terminalSessionKey('n10-shell-1a2b3c'),
  kind: 'shell',
  path: '/home/dev/notes',
};

describe('startSessionDiscovery', () => {
  // A detached-HEAD worktree has no branch, so the scanner has to key
  // it by its checkout rather than reading `branch` — which for an
  // orphan is ''.
  it('keys a detached-HEAD worktree by its checkout', async () => {
    listWorktreesMock.mockResolvedValue([
      { branch: '', path: '/repo/.claude/worktrees/detached', bare: false },
    ]);
    listPersistedMock.mockReturnValue(new Set([wtKey('detached')]));
    const { discovery, adopt } = start();
    await discovery.scanNow();
    expect(adopt.mock.calls[0]?.[0]).toEqual({
      name: wtKey('detached'),
      branch: '',
      path: '/repo/.claude/worktrees/detached',
    });
  });

  it('attaches to a session that appears while running', async () => {
    const { discovery, adopt, onChanged } = start();
    await discovery.scanNow();
    expect(adopt).not.toHaveBeenCalled();

    listWorktreesMock.mockResolvedValue(worktrees('feature-a'));
    listPersistedMock.mockReturnValue(new Set([wtKey('feature-a')]));
    await discovery.scanNow();

    expect(adopt).toHaveBeenCalledTimes(1);
    expect(adopt.mock.calls[0]![0]).toEqual({
      name: wtKey('feature-a'),
      branch: 'feature-a',
      path: '/repo/.claude/worktrees/feature-a',
    });
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('attaches on the first scan to a session that outlived the last run', async () => {
    listWorktreesMock.mockResolvedValue(worktrees('feature-a'));
    listPersistedMock.mockReturnValue(new Set([wtKey('feature-a')]));
    const { discovery, adopt } = start();
    await discovery.scanNow();
    expect(adopt).toHaveBeenCalledTimes(1);
  });

  // The registry entry is live, so attaching again would dispose the
  // PTY the user is looking at.
  it('never attaches twice to the same live session', async () => {
    listWorktreesMock.mockResolvedValue(worktrees('feature-a'));
    listPersistedMock.mockReturnValue(new Set([wtKey('feature-a')]));
    const { discovery, adopt } = start();
    await discovery.scanNow();
    await discovery.scanNow();
    await discovery.scanNow();
    expect(adopt).toHaveBeenCalledTimes(1);
  });

  // The registry is re-read per iteration, not once when the scan
  // looked: an earlier attach in the same loop can take long enough for
  // the user to launch this session themselves, and handing a live one
  // to spawnSession disposes the PTY and emulator behind the pane they
  // are looking at.
  it('never attaches to a session the user launched mid-scan', async () => {
    listWorktreesMock.mockResolvedValue(worktrees('slow', 'raced'));
    listPersistedMock.mockReturnValue(new Set([wtKey('slow'), wtKey('raced')]));
    const adopt = vi
      .fn<(wt: DiscoveredWorktree) => Promise<void>>()
      .mockImplementation(async (wt) => {
        await Promise.resolve();
        alive.add(wt.name);
        // While the first attach was awaiting, the user hit Enter on
        // the second row.
        if (wt.name === wtKey('slow')) alive.add(wtKey('raced'));
      });
    const { discovery } = start({ adopt });
    await discovery.scanNow();
    expect(adopt.mock.calls.map((c) => c[0].name)).toEqual([wtKey('slow')]);
  });

  it('announces a new worktree that has no session behind it', async () => {
    const { discovery, onChanged, adopt } = start();
    await discovery.scanNow();
    listWorktreesMock.mockResolvedValue(worktrees('feature-a'));
    await discovery.scanNow();
    expect(adopt).not.toHaveBeenCalled();
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(onChanged.mock.calls[0]![0]).toMatchObject({
      appeared: [expect.objectContaining({ name: wtKey('feature-a') })],
    });
  });

  it('announces a session killed from outside', async () => {
    listWorktreesMock.mockResolvedValue(worktrees('feature-a'));
    listPersistedMock.mockReturnValue(new Set([wtKey('feature-a')]));
    const { discovery, onChanged } = start();
    await discovery.scanNow();
    onChanged.mockClear();

    listPersistedMock.mockReturnValue(new Set());
    await discovery.scanNow();
    expect(onChanged.mock.calls[0]![0]).toMatchObject({
      ended: [wtKey('feature-a')],
    });
  });

  it('says nothing when nothing changed', async () => {
    listWorktreesMock.mockResolvedValue(worktrees('feature-a'));
    const { discovery, onChanged } = start();
    await discovery.scanNow();
    await discovery.scanNow();
    await discovery.scanNow();
    expect(onChanged).not.toHaveBeenCalled();
  });

  // Announcing first would have the shell re-read the registry before
  // the attach had put anything in it, and report the session as idle.
  it('announces only after the attach has finished', async () => {
    const order: string[] = [];
    listWorktreesMock.mockResolvedValue(worktrees('feature-a'));
    listPersistedMock.mockReturnValue(new Set([wtKey('feature-a')]));
    const { discovery } = start({
      adopt: async (wt) => {
        await Promise.resolve();
        alive.add(wt.name);
        order.push('adopt');
      },
      onChanged: () => order.push('changed'),
    });
    await discovery.scanNow();
    expect(order).toEqual(['adopt', 'changed']);
  });

  describe('a failing attach', () => {
    // The failures worth surviving are transient — a `git worktree add`
    // losing to an index.lock — so one is not enough to give up on.
    it('is retried a few times before the session is retired', async () => {
      listWorktreesMock.mockResolvedValue(worktrees('feature-a'));
      listPersistedMock.mockReturnValue(new Set([wtKey('feature-a')]));
      const adopt = vi.fn().mockRejectedValue(new Error('no worktree'));
      const { discovery } = start({ adopt });
      for (let i = 0; i < 6; i++) await discovery.scanNow();
      expect(adopt).toHaveBeenCalledTimes(3);
    });

    it('succeeds if a retry works, and forgets the earlier failures', async () => {
      listWorktreesMock.mockResolvedValue(worktrees('feature-a'));
      listPersistedMock.mockReturnValue(new Set([wtKey('feature-a')]));
      const adopt = vi
        .fn<(wt: DiscoveredWorktree) => void>()
        .mockImplementationOnce(() => {
          throw new Error('index.lock');
        })
        .mockImplementation((wt) => {
          alive.add(wt.name);
        });
      const { discovery, onChanged } = start({ adopt });
      await discovery.scanNow();
      await discovery.scanNow();
      expect(adopt).toHaveBeenCalledTimes(2);
      expect(onChanged).toHaveBeenCalledTimes(1);
    });

    // A retired session is offered to nobody, so there is nothing to
    // report. Announcing anyway refreshed both shells every tick for
    // the life of the process.
    it('stops reporting the world as changed once retired', async () => {
      listWorktreesMock.mockResolvedValue(worktrees('feature-a'));
      listPersistedMock.mockReturnValue(new Set([wtKey('feature-a')]));
      const adopt = vi.fn().mockRejectedValue(new Error('no worktree'));
      const { discovery, onChanged } = start({ adopt });
      for (let i = 0; i < 6; i++) await discovery.scanNow();
      expect(onChanged).not.toHaveBeenCalled();
    });

    it('is tried again once tmux has dropped that session', async () => {
      listWorktreesMock.mockResolvedValue(worktrees('feature-a'));
      listPersistedMock.mockReturnValue(new Set([wtKey('feature-a')]));
      const adopt = vi.fn().mockRejectedValue(new Error('no worktree'));
      const { discovery } = start({ adopt });
      for (let i = 0; i < 6; i++) await discovery.scanNow();
      expect(adopt).toHaveBeenCalledTimes(3);

      // tmux drops it, and a new session appears under the same name.
      listPersistedMock.mockReturnValue(new Set());
      await discovery.scanNow();
      listPersistedMock.mockReturnValue(new Set([wtKey('feature-a')]));
      await discovery.scanNow();
      expect(adopt).toHaveBeenCalledTimes(4);
    });

    // One unattachable worktree must not cost the user every agent
    // behind it in the list.
    it('does not stop the others in the same scan', async () => {
      listWorktreesMock.mockResolvedValue(worktrees('broken', 'fine'));
      listPersistedMock.mockReturnValue(
        new Set([wtKey('broken'), wtKey('fine')])
      );
      const adopt = vi
        .fn<(wt: DiscoveredWorktree) => void>()
        .mockImplementation((wt) => {
          if (wt.name === wtKey('broken')) throw new Error('git refused');
          alive.add(wt.name);
        });
      const { discovery } = start({ adopt });
      await discovery.scanNow();
      expect(adopt.mock.calls.map((c) => c[0].name)).toEqual([
        wtKey('broken'),
        wtKey('fine'),
      ]);
      expect(alive.has(wtKey('fine'))).toBe(true);
    });

    it('does not take the process down', async () => {
      listWorktreesMock.mockResolvedValue(worktrees('feature-a'));
      listPersistedMock.mockReturnValue(new Set([wtKey('feature-a')]));
      const { discovery } = start({
        adopt: () => {
          throw new Error('boom');
        },
      });
      await expect(discovery.scanNow()).resolves.toBeUndefined();
    });
  });

  describe('terminal sessions', () => {
    // The restore path: a terminal tab from the previous run is a tmux
    // session with nobody attached, and the first scan is what brings
    // it back — through the shell's own launch path, with the directory
    // tmux remembered for it.
    it('attaches on the first scan to a terminal that outlived the last run', async () => {
      listTerminalsMock.mockReturnValue([shellTerm]);
      const { discovery, adoptTerminal, onChanged } = start();
      await discovery.scanNow();
      expect(adoptTerminal).toHaveBeenCalledTimes(1);
      expect(adoptTerminal.mock.calls[0]![0]).toEqual(shellTerm);
      expect(onChanged).toHaveBeenCalledTimes(1);
    });

    it('attaches to a terminal that appears mid-run, once', async () => {
      const { discovery, adoptTerminal } = start();
      await discovery.scanNow();
      listTerminalsMock.mockReturnValue([shellTerm]);
      await discovery.scanNow();
      await discovery.scanNow();
      expect(adoptTerminal).toHaveBeenCalledTimes(1);
    });

    // A terminal this process started is in the registry already;
    // attaching again would dispose the PTY behind the pane on screen.
    it('never attaches to a terminal that is already alive here', async () => {
      alive.add(shellTerm.name);
      listTerminalsMock.mockReturnValue([shellTerm]);
      const { discovery, adoptTerminal, onChanged } = start();
      await discovery.scanNow();
      expect(adoptTerminal).not.toHaveBeenCalled();
      expect(onChanged).not.toHaveBeenCalled();
    });

    it('reconciles retained terminal tabs on the first scan after a repository switch', async () => {
      const name = terminalSessionKey('removed-agent');
      sessionNamesMock.mockReturnValue([name]);
      const { discovery, onChanged } = start();
      await discovery.scanNow();
      expect(onChanged).toHaveBeenCalledWith(
        expect.objectContaining({ endedTerminals: [name] })
      );
    });

    it('announces a terminal killed from outside', async () => {
      alive.add(shellTerm.name);
      listTerminalsMock.mockReturnValue([shellTerm]);
      const { discovery, onChanged } = start();
      await discovery.scanNow();
      listTerminalsMock.mockReturnValue([]);
      await discovery.scanNow();
      expect(onChanged).toHaveBeenCalledTimes(1);
      expect(onChanged.mock.calls[0]![0]).toMatchObject({
        endedTerminals: [shellTerm.name],
      });
    });

    it('retires a terminal that keeps failing to attach', async () => {
      listTerminalsMock.mockReturnValue([shellTerm]);
      const adoptTerminal = vi.fn().mockRejectedValue(new Error('gone'));
      const { discovery, onChanged } = start({ adoptTerminal });
      for (let i = 0; i < 6; i++) await discovery.scanNow();
      expect(adoptTerminal).toHaveBeenCalledTimes(3);
      expect(onChanged).not.toHaveBeenCalled();
    });

    // A shell with no terminal tabs (the TUI) passes no `adoptTerminal`,
    // and must not be told every scan that there is something to do.
    it('ignores terminals entirely for a shell that cannot adopt them', async () => {
      listTerminalsMock.mockReturnValue([shellTerm]);
      const { discovery, onChanged } = start({ adoptTerminal: undefined });
      await discovery.scanNow();
      await discovery.scanNow();
      expect(onChanged).not.toHaveBeenCalled();
    });
  });

  it('survives git failing', async () => {
    listWorktreesMock.mockRejectedValue(new Error('git exploded'));
    const { discovery, onChanged } = start();
    await expect(discovery.scanNow()).resolves.toBeUndefined();
    expect(onChanged).not.toHaveBeenCalled();
  });

  describe('scheduling', () => {
    it('scans on the interval', async () => {
      const { discovery } = start();
      await discovery.scanNow();
      const before = listWorktreesMock.mock.calls.length;
      await vi.advanceTimersByTimeAsync(3000);
      expect(listWorktreesMock.mock.calls.length).toBeGreaterThan(before);
    });

    it('stops scanning after stop()', async () => {
      const { discovery } = start();
      await discovery.scanNow();
      discovery.stop();
      const before = listWorktreesMock.mock.calls.length;
      await vi.advanceTimersByTimeAsync(5000);
      expect(listWorktreesMock.mock.calls.length).toBe(before);
    });

    // Two overlapping scans would diff against each other's `previous`
    // and could offer the same session to `adopt` twice.
    it('never runs two scans at once', async () => {
      let active = 0;
      let peak = 0;
      listWorktreesMock.mockImplementation(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await Promise.resolve();
        active -= 1;
        return [];
      });
      const { discovery } = start();
      await Promise.all([
        discovery.scanNow(),
        discovery.scanNow(),
        discovery.scanNow(),
      ]);
      expect(peak).toBe(1);
    });

    // Three simultaneous callers do not buy three scans: the one that
    // has not started yet can still answer for all of them, so they
    // join it. Only the scan already looking cannot.
    it('coalesces concurrent callers onto one queued scan', async () => {
      const { discovery } = start();
      await discovery.scanNow();
      const before = listWorktreesMock.mock.calls.length;
      await Promise.all([
        discovery.scanNow(),
        discovery.scanNow(),
        discovery.scanNow(),
      ]);
      expect(listWorktreesMock.mock.calls.length).toBe(before + 1);
    });

    // The in-loop guard, not the one at the top of the scan: the repo
    // can be switched while an earlier attach is still awaiting, and
    // carrying on would run this repo's branch names against the new
    // checkout.
    it('stops attaching the moment another repository is opened', async () => {
      listWorktreesMock.mockResolvedValue(worktrees('first', 'second'));
      listPersistedMock.mockReturnValue(
        new Set([wtKey('first'), wtKey('second')])
      );
      let current = true;
      const adopt = vi
        .fn<(wt: DiscoveredWorktree) => Promise<void>>()
        .mockImplementation(async (wt) => {
          await Promise.resolve();
          alive.add(wt.name);
          current = false; // the user opens another repo mid-flight
        });
      const { discovery } = start({ adopt, isCurrent: () => current });
      await discovery.scanNow();
      expect(adopt.mock.calls.map((c) => c[0].name)).toEqual([wtKey('first')]);
    });

    it('abandons a scan when the repo is no longer current', async () => {
      listWorktreesMock.mockResolvedValue(worktrees('feature-a'));
      listPersistedMock.mockReturnValue(new Set([wtKey('feature-a')]));
      const { discovery, adopt, onChanged } = start({
        isCurrent: () => false,
      });
      await discovery.scanNow();
      expect(adopt).not.toHaveBeenCalled();
      expect(onChanged).not.toHaveBeenCalled();
    });
  });

  describe('the worktrees directory watch', () => {
    it('watches the resolver base, one directory, not recursively', () => {
      start();
      expect(watchMock).toHaveBeenCalledWith(
        '/repo/.claude/worktrees',
        expect.objectContaining({ recursive: false, persistent: false }),
        expect.any(Function)
      );
    });

    it('scans off-cycle when the directory changes', async () => {
      const watcher = captureWatcher();
      const { discovery } = start();
      await discovery.scanNow();
      const before = listWorktreesMock.mock.calls.length;

      watcher.trigger();
      await vi.advanceTimersByTimeAsync(500);
      expect(listWorktreesMock.mock.calls.length).toBeGreaterThan(before);
    });

    it('coalesces a burst of events into one scan', async () => {
      const watcher = captureWatcher();
      const { discovery } = start();
      await discovery.scanNow();
      const before = listWorktreesMock.mock.calls.length;

      for (let i = 0; i < 10; i++) watcher.trigger();
      await vi.advanceTimersByTimeAsync(500);
      expect(listWorktreesMock.mock.calls.length).toBe(before + 1);
    });

    it('releases the watch on stop()', async () => {
      const watcher = captureWatcher();
      const { discovery } = start();
      await discovery.scanNow();
      discovery.stop();
      expect(watcher.handle.close).toHaveBeenCalled();
    });

    // Nothing creates the worktrees directory until the first worktree
    // is made, so an unwatchable path has to be ordinary, not fatal.
    it('keeps scanning when the directory cannot be watched', async () => {
      watchMock.mockImplementation(() => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      });
      const { discovery, onChanged } = start();
      await discovery.scanNow();
      listWorktreesMock.mockResolvedValue(worktrees('feature-a'));
      await discovery.scanNow();
      expect(onChanged).toHaveBeenCalled();
    });

    // A watch on a directory that is later deleted errors rather than
    // going quiet, and a dropped watcher that is never replaced makes
    // the feature silently slower for the rest of the run.
    it('replaces a watcher that errors', async () => {
      const handle = { close: vi.fn(), on: vi.fn() };
      watchMock.mockReturnValue(handle);
      const { discovery } = start();
      await discovery.scanNow();
      const before = watchMock.mock.calls.length;

      const onError = handle.on.mock.calls.find(
        ([event]) => event === 'error'
      )?.[1] as () => void;
      expect(onError).toBeDefined();
      onError();
      expect(handle.close).toHaveBeenCalled();

      await discovery.scanNow();
      expect(watchMock.mock.calls.length).toBe(before + 1);
    });

    it('re-establishes the watch once the directory exists', async () => {
      watchMock.mockImplementationOnce(() => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      });
      const { discovery } = start();
      await discovery.scanNow();
      expect(watchMock.mock.calls.length).toBeGreaterThan(1);
    });
  });
});
