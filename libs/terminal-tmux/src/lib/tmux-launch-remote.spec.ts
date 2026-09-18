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

  it('throws rather than silently degrading for restart/replace, which need a per-transport incarnation notion not built yet', async () => {
    const { executor } = fakeExecutor({});
    await expect(
      prepareRemoteTmuxSession(executor, spec, { mode: 'restart', target: 'x' })
    ).rejects.toThrow(/do not support "restart"/);
    await expect(
      prepareRemoteTmuxSession(executor, spec, {
        mode: 'replace',
        target: 'x',
        expected: {
          name: 'x',
          sessionId: '$0',
          paneId: '%0',
          panePid: 1,
          serverPid: 1,
        },
      })
    ).rejects.toThrow(/do not support "replace"/);
  });
});
