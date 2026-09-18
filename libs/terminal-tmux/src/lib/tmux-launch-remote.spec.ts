import { describe, expect, it } from 'vitest';
import { prepareRemoteTmuxSession } from './tmux-launch-remote.js';
import type { TmuxLaunchPlan } from './tmux-launch.js';
import type { MachineExecutor } from './tmux-cli.js';
import type { SessionSpec } from '@n10/terminal';

const spec: SessionSpec = {
  cmd: '/bin/sh',
  args: ['-c', 'agent'],
  cwd: '/tmp',
  cols: 80,
  rows: 24,
};

function fakeExecutor(opts: {
  hasSession?: (name: string) => boolean;
  fail?: string;
  /** `undefined` for a name means "no such pane" (null pane state);
   *  otherwise whether it reads as dead. */
  paneDead?: (name: string) => boolean | undefined;
}): { executor: MachineExecutor; calls: string[] } {
  const calls: string[] = [];
  const executor: MachineExecutor = {
    async run(argv) {
      calls.push(argv.join(' '));
      const [, ...tmuxArgs] = argv;
      if (tmuxArgs[0] === 'has-session') {
        const name = tmuxArgs[2]!.replace(/^=/, '').replace(/:$/, '');
        return {
          stdout: '',
          stderr: '',
          code: opts.hasSession?.(name) ? 0 : 1,
        };
      }
      if (tmuxArgs.includes('display-message')) {
        const target = tmuxArgs[tmuxArgs.indexOf('-t') + 1]!;
        const name = target.replace(/^=/, '').replace(/:$/, '');
        const dead = opts.paneDead?.(name);
        if (dead === undefined) return { stdout: '', stderr: '', code: 0 };
        return { stdout: `%0\t${dead ? '1' : '0'}\t\t\n`, stderr: '', code: 0 };
      }
      if (opts.fail && argv.join(' ').includes(opts.fail))
        return { stdout: '', stderr: 'boom', code: 1 };
      return { stdout: '', stderr: '', code: 0 };
    },
  };
  return { executor, calls };
}

describe('prepareRemoteTmuxSession (D5: the same plan, executed remotely)', () => {
  it('produces the same tmux argv as the local create path, routed through the executor', async () => {
    const plan: TmuxLaunchPlan = {
      mode: 'create',
      label: 'test',
      tags: { '@agent': 'example' },
      retainOnExit: true,
    };
    const { executor, calls } = fakeExecutor({ hasSession: () => false });
    const name = await prepareRemoteTmuxSession(executor, spec, plan);
    expect(name).toBe('test');

    // Same commands, same order, same argv as the local create path in
    // tmux-launch.ts's `create()` (pinned independently in
    // tmux-backend.spec.ts) — only "-t =test:" targeting and the
    // executor doing the running differ from a local invocation.
    expect(calls[0]).toBe('tmux has-session -t =test:');
    expect(calls[1]).toMatch(
      /^tmux new-session -d -s test -c \/tmp -x 80 -y 24( -e \S+=\S+)* -- \/bin\/sh -c exec sleep 86400$/
    );
    expect(calls[2]).toMatch(
      /^tmux set-option -t =test: @agent example ; set-option -t =test: remain-on-exit on ; set-option -t =test: status off ; respawn-pane -k -t =test: -c \/tmp( -e \S+=\S+)* -- \/bin\/sh -c agent$/
    );
  });

  it('tries the next candidate name when the preferred one is taken', async () => {
    const { executor, calls } = fakeExecutor({
      hasSession: (n) => n === 'test',
    });
    const name = await prepareRemoteTmuxSession(executor, spec, {
      mode: 'create',
      label: 'test',
      tags: {},
    });
    expect(name).toBe('test-2');
    expect(calls[0]).toBe('tmux has-session -t =test:');
    expect(calls[1]).toBe('tmux has-session -t =test-2:');
  });

  it('kills the newly created session and rethrows when metadata setup fails', async () => {
    const { executor, calls } = fakeExecutor({
      hasSession: () => false,
      fail: 'set-option',
    });
    await expect(
      prepareRemoteTmuxSession(executor, spec, {
        mode: 'create',
        label: 'test',
        tags: {},
      })
    ).rejects.toThrow(/session setup failed/);
    expect(calls.some((c) => c.startsWith('tmux kill-session -t =test:'))).toBe(
      true
    );
  });

  it('runs a plain attach without rewriting metadata', async () => {
    const { executor, calls } = fakeExecutor({});
    const name = await prepareRemoteTmuxSession(executor, spec, {
      mode: 'attach',
      target: 'existing',
    });
    expect(name).toBe('existing');
    expect(calls).toEqual(['tmux set-option -t =existing: status off']);
  });

  it('throws rather than silently degrading for replace and a guarded restart, which need a per-transport incarnation notion not built yet', async () => {
    const { executor } = fakeExecutor({ paneDead: () => true });
    const expected = {
      name: 'x',
      sessionId: '$0',
      paneId: '%0',
      panePid: 1,
      serverPid: 1,
    };
    await expect(
      prepareRemoteTmuxSession(executor, spec, {
        mode: 'restart',
        target: 'x',
        expected,
      })
    ).rejects.toThrow(/do not support "restart"/);
    await expect(
      prepareRemoteTmuxSession(executor, spec, {
        mode: 'replace',
        target: 'x',
        expected,
      })
    ).rejects.toThrow(/do not support "replace"/);
  });

  // Finding 6: an unguarded restart (no `expected` — every terminal
  // restart, and a worktree resume nobody has confirmed replacing) is
  // the same tmux argv as the local path, run through the executor.
  describe('an unguarded restart (finding 6)', () => {
    it('respawns a dead pane without -k, and updates metadata in the same command queue', async () => {
      const { executor, calls } = fakeExecutor({ paneDead: () => true });
      const name = await prepareRemoteTmuxSession(executor, spec, {
        mode: 'restart',
        target: 'x',
        tags: { '@agent': 'claude' },
        retainOnExit: true,
      });
      expect(name).toBe('x');
      expect(calls[0]).toContain('display-message');
      expect(calls[1]).toMatch(
        /^tmux respawn-pane -t =x: -c \/tmp( -e \S+=\S+)* -- \/bin\/sh -c agent ; set-option -t =x: @agent claude ; set-option -t =x: remain-on-exit on ; set-option -t =x: status off$/
      );
      expect(calls.join(' ')).not.toMatch(/respawn-pane -k/);
    });

    it('refuses to restart a running pane', async () => {
      const { executor } = fakeExecutor({ paneDead: () => false });
      await expect(
        prepareRemoteTmuxSession(executor, spec, {
          mode: 'restart',
          target: 'x',
          tags: {},
        })
      ).rejects.toThrow(/Cannot restart a running or missing tmux pane/);
    });

    it('refuses to restart a pane that no longer exists', async () => {
      const { executor } = fakeExecutor({ paneDead: () => undefined });
      await expect(
        prepareRemoteTmuxSession(executor, spec, {
          mode: 'restart',
          target: 'x',
          tags: {},
        })
      ).rejects.toThrow(/Cannot restart a running or missing tmux pane/);
    });
  });
});
