import { worktreeSessionKey } from './session-key.js';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { orchestraFixture } from '../../tests/orchestra-fixture.js';
import { listLiveWorktreeSessions } from './discovery/live-worktree-sessions.js';
import { getSession, killAll } from './pty-registry.js';
import { getSessionLaunchContext } from './session/session-launch-context.js';
import { launchSession } from './session/launch-session.js';
import { openSession } from './session/open-session.js';
import { listOurSessions, resolveWorktreeSession } from './session-resolver.js';

const target = 'codex:11111111-2222-4333-8444-555555555555';
const branch = 'feature/integration';

describe.skipIf(spawnSync('tmux', ['-V']).status !== 0)(
  'installed Orchestra plugin',
  () => {
    let fixture: ReturnType<typeof orchestraFixture>;
    beforeEach(() => {
      fixture = orchestraFixture();
    });
    afterEach(() => fixture?.close());

    async function spawnPlayer(prompt = 'Do the fixture task') {
      const result = fixture.script(
        'spawn.sh',
        '--branch',
        branch,
        '--from',
        'main',
        '--agent',
        'codex',
        '--prompt',
        prompt,
        '--orchestrator',
        target,
        '--no-node-modules'
      );
      expect({ status: result.status, stderr: result.stderr }).toEqual({
        status: 0,
        stderr: '',
      });
      await expect
        .poll(() => existsSync(join(fixture.home, 'agent-start.json')))
        .toBe(true);
      // The pinned plugin predates `@orchestra-worktree-path`, which the
      // current plugin writes at spawn; without it the player is foreign
      // to n10. Write it the way the plugin does: the canonical checkout.
      const [name, path] = fixture
        .tmux(
          'list-sessions',
          '-F',
          '#{session_name}\t#{session_path}\t#{@orchestra-branch}'
        )
        .split('\n')
        .map((line) => line.split('\t'))
        .find((cols) => cols[2] === branch)!;
      fixture.tmux(
        'set-option',
        '-t',
        `=${name}:`,
        '@orchestra-worktree-path',
        realpathSync(path!)
      );
      // Found by the branch Orchestra tagged it with, once: from here on
      // it is addressed by its checkout, as n10 addresses it.
      const session = listOurSessions().find(
        (s) =>
          s.type === 'worktree' &&
          s.repo === fixture.repo &&
          s.branch === branch
      );
      expect(session).toBeDefined();
      expect(
        resolveWorktreeSession(fixture.repo, session!.worktreePath)
      ).toEqual(session);
      return session!;
    }

    it('installs the package, launches a player, and attaches n10 without replacing it', async () => {
      const manifest = JSON.parse(
        readFileSync(join(fixture.plugin, '.claude-plugin/plugin.json'), 'utf8')
      );
      expect(manifest).toMatchObject({ name: 'orchestra', version: '1.0.0' });
      for (const skill of ['orchestrator', 'player']) {
        expect(
          readFileSync(
            join(fixture.plugin, 'skills', skill, 'SKILL.md'),
            'utf8'
          )
        ).toContain(`name: ${skill}`);
      }
      // A collision must not claim an untagged terminal, and a >16 KiB
      // prompt must reach the agent unchanged through the real buffer path.
      fixture.tmux(
        'new-session',
        '-d',
        '-s',
        'shop-feature-integration',
        'sleep',
        '300'
      );
      const prompt =
        'Literal $(touch SHOULD_NOT_EXIST) `echo nope`\n' +
        'task '.repeat(4000);
      const player = await spawnPlayer(prompt);
      expect(player.name).toBe('shop-feature-integration-2');
      const started = JSON.parse(fixture.read('agent-start.json')) as {
        args: string[];
        tmux: string | null;
      };
      expect(started.args.at(-1)).toBe(`$player ${prompt}`);
      expect(started.tmux).toBeNull();
      expect(existsSync(join(player.path, 'SHOULD_NOT_EXIST'))).toBe(false);
      expect(listLiveWorktreeSessions()).toEqual([
        expect.objectContaining({
          tmuxName: player.name,
          repoRoot: fixture.repo,
          branch,
          agent: 'codex',
          orchestrator: target,
        }),
      ]);
      const beforePid = fixture.tmux(
        'display-message',
        '-p',
        '-t',
        `=${player.name}:`,
        '#{pane_pid}'
      );
      const entry = await openSession({
        session: { type: 'worktree', repo: fixture.repo, path: player.path },
        mode: 'attach',
        cwd: player.path,
        cols: 80,
        rows: 24,
        build: () => {
          throw new Error('Attaching must not launch another agent');
        },
      });
      expect(entry.agent).toBe('codex');
      expect(getSession(worktreeSessionKey(player.path, fixture.repo))).toBe(
        entry
      );
      expect(entry.pty.name).toBe(player.name);
      expect(
        fixture.tmux(
          'display-message',
          '-p',
          '-t',
          `=${player.name}:`,
          '#{pane_pid}'
        )
      ).toBe(beforePid);
      expect(resolveWorktreeSession(fixture.repo, player.worktreePath)).toEqual(
        player
      );
      expect(listOurSessions()).toHaveLength(1);
      const killed = fixture.script('kill.sh', branch);
      expect({ status: killed.status, stderr: killed.stderr }).toEqual({
        status: 0,
        stderr: '',
      });
      expect(
        resolveWorktreeSession(fixture.repo, player.worktreePath)
      ).toBeNull();
      expect(existsSync(player.path)).toBe(true);
      expect(
        fixture.tmux('has-session', '-t', '=shop-feature-integration:')
      ).toBe('');
    });

    it('runs reports inside the fake player and exposes delivery failures without advancing last-report', async () => {
      const player = await spawnPlayer();
      const send = fixture.script(
        'send.sh',
        branch,
        '--raw',
        'report first update'
      );
      expect({ status: send.status, stderr: send.stderr }).toEqual({
        status: 0,
        stderr: '',
      });
      await expect
        .poll(() => existsSync(join(fixture.home, 'report-result.json')))
        .toBe(true);
      expect(JSON.parse(fixture.read('report-result.json')).status).toBe(0);
      expect(JSON.parse(fixture.read('deliveries.jsonl').trim())).toEqual([
        'queue',
        '--thread',
        target.slice(6),
        '--message',
        `[player ${player.name}] PROGRESS: first update`,
      ]);
      const lastReport = resolveWorktreeSession(
        fixture.repo,
        player.worktreePath
      )?.lastReport;
      expect(lastReport).toMatch(/^PROGRESS \d{4}-.*Z$/);
      writeFileSync(join(fixture.home, 'refuse-queue'), '1');
      rmSync(join(fixture.home, 'report-result.json'));
      const failed = fixture.script(
        'send.sh',
        branch,
        '--raw',
        'report complete failed message'
      );
      expect({ status: failed.status, stderr: failed.stderr }).toEqual({
        status: 0,
        stderr: '',
      });
      await expect
        .poll(() => existsSync(join(fixture.home, 'report-result.json')))
        .toBe(true);
      const result = JSON.parse(fixture.read('report-result.json'));
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`Target: ${target}`);
      expect(result.stderr).toContain(
        'Reason: Codex queue refused the message'
      );
      expect(result.stderr).toContain(
        `Report: [player ${player.name}] PROGRESS: complete failed message`
      );
      expect(
        resolveWorktreeSession(fixture.repo, player.worktreePath)?.lastReport
      ).toBe(lastReport);
      expect(fixture.read('deliveries.jsonl').trim().split('\n')).toHaveLength(
        1
      );
    });

    it('retains an exited Orchestra player and resumes its recorded agent after reconnecting', async () => {
      const player = await spawnPlayer();
      const first = JSON.parse(fixture.read('agent-start.json')) as {
        pid: number;
      };
      process.kill(first.pid, 'SIGTERM');
      await expect
        .poll(
          () =>
            resolveWorktreeSession(fixture.repo, player.worktreePath)?.paneDead
        )
        .toBe(true);
      expect(listLiveWorktreeSessions()).toEqual([]);
      killAll();
      const attached = await openSession({
        session: { type: 'worktree', repo: fixture.repo, path: player.path },
        mode: 'attach',
        cwd: player.path,
        cols: 80,
        rows: 24,
        build: () => {
          throw new Error('Discovery must not restart a stopped agent');
        },
      });
      await expect.poll(() => attached.exited).toBe(true);
      rmSync(join(fixture.home, 'agent-start.json'));
      const resumed = await launchSession({
        name: worktreeSessionKey(player.path, fixture.repo),
        cwd: player.path,
        cols: 80,
        rows: 24,
        config: { agentId: 'claude', vendorAuth: {}, vendorProject: {} },
        request: { intent: 'continue-or-blank' },
      });
      await expect
        .poll(() => existsSync(join(fixture.home, 'agent-start.json')))
        .toBe(true);
      const next = JSON.parse(fixture.read('agent-start.json'));
      expect(next.pid).not.toBe(first.pid);
      expect(next.args).toEqual(['resume', '--last']);
      expect(resumed.pty.name).toBe(player.name);
      expect(resumed.agent).toBe('codex');
      expect(
        resolveWorktreeSession(fixture.repo, player.worktreePath)
      ).toMatchObject({
        paneDead: false,
        agent: 'codex',
        spawner: 'orchestra',
        orchestrator: target,
      });
    });

    it('starts a fresh agent with provenance intact and reporting detached, including inherited Orchestra environment', async () => {
      const player = await spawnPlayer();
      const name = worktreeSessionKey(player.path, fixture.repo);
      const config = {
        agentId: 'claude' as const,
        vendorAuth: {},
        vendorProject: {},
      };
      fixture.tmux(
        'set-option',
        '-t',
        `=${player.name}:`,
        '@orchestra-last-report',
        'PROGRESS 2026-01-01T00:00:00Z'
      );
      // A stale server/session environment must not point the new conversation
      // at another player's supervisor after its own tags have been cleared.
      fixture.tmux(
        'set-option',
        '-t',
        '=fixture-anchor:',
        '@orchestra-orchestrator',
        target
      );
      fixture.tmux(
        'set-environment',
        '-t',
        `=${player.name}:`,
        'ORCHESTRA_SESSION',
        'fixture-anchor'
      );
      fixture.tmux(
        'set-environment',
        '-t',
        `=${player.name}:`,
        'ORCHESTRA_SOCKET',
        fixture.tmux('display-message', '-p', '#{socket_path}')
      );
      const context = getSessionLaunchContext(name, config);
      expect(context).toMatchObject({
        running: true,
        recordedAgent: 'codex',
        orchestrator: target,
        lastReport: { kind: 'PROGRESS', timestamp: '2026-01-01T00:00:00Z' },
      });
      rmSync(join(fixture.home, 'agent-start.json'));
      const next = await launchSession({
        name,
        cwd: player.path,
        cols: 80,
        rows: 24,
        config,
        request: { intent: 'blank' },
        fresh: true,
        expected: context.incarnation,
      });
      await expect
        .poll(() => existsSync(join(fixture.home, 'agent-start.json')))
        .toBe(true);
      expect(next.agent).toBe('claude');
      const current = resolveWorktreeSession(
        fixture.repo,
        player.worktreePath
      )!;
      expect(current).toMatchObject({
        name: player.name,
        repo: fixture.repo,
        branch,
        spawner: 'orchestra',
        agent: 'claude',
      });
      expect(current.orchestrator).toBeUndefined();
      expect(current.lastReport).toBeUndefined();
      expect(
        fixture.script('send.sh', branch, '--raw', 'orchestrator').status
      ).toBe(0);
      await expect
        .poll(() => existsSync(join(fixture.home, 'report-result.json')))
        .toBe(true);
      expect(JSON.parse(fixture.read('report-result.json'))).toMatchObject({
        status: 0,
        stdout: '<unset>\n',
      });
    });

    it('clears reporting for an implicit fresh same-agent launch on a stopped player', async () => {
      const player = await spawnPlayer();
      const first = JSON.parse(fixture.read('agent-start.json')) as {
        pid: number;
      };
      process.kill(first.pid, 'SIGTERM');
      await expect
        .poll(
          () =>
            resolveWorktreeSession(fixture.repo, player.worktreePath)?.paneDead
        )
        .toBe(true);
      await launchSession({
        name: worktreeSessionKey(player.path, fixture.repo),
        cwd: player.path,
        cols: 80,
        rows: 24,
        config: { agentId: 'codex', vendorAuth: {}, vendorProject: {} },
        request: { intent: 'blank' },
      });
      expect(
        resolveWorktreeSession(fixture.repo, player.worktreePath)
      ).toMatchObject({
        agent: 'codex',
        spawner: 'orchestra',
      });
      expect(
        resolveWorktreeSession(fixture.repo, player.worktreePath)?.orchestrator
      ).toBeUndefined();
    });

    it('lets Orchestra adopt and stop a n10-created player while preserving creator identity', async () => {
      const entry = await openSession({
        session: {
          type: 'worktree',
          repo: fixture.repo,
          path: fixture.repo,
          branch: 'main',
        },
        cwd: fixture.repo,
        cols: 80,
        rows: 24,
        build: () => ({ spec: { cmd: 'codex', args: [] }, agent: 'codex' }),
      });
      await expect
        .poll(() => existsSync(join(fixture.home, 'agent-start.json')))
        .toBe(true);
      const player = resolveWorktreeSession(fixture.repo, fixture.repo)!;
      expect(player.spawner).toBe('n10');
      const adopted = fixture.script(
        'adopt.sh',
        player.name,
        '--agent',
        'codex',
        '--orchestrator',
        target,
        'handoff task'
      );
      expect({ status: adopted.status, stderr: adopted.stderr }).toEqual({
        status: 0,
        stderr: '',
      });
      await expect
        .poll(() => existsSync(join(fixture.home, 'agent-input.jsonl')))
        .toBe(true);
      expect(fixture.read('agent-input.jsonl')).toContain(
        '$player handoff task'
      );
      expect(resolveWorktreeSession(fixture.repo, fixture.repo)).toMatchObject({
        spawner: 'n10',
        orchestrator: target,
      });
      expect(fixture.script('kill.sh', player.name).status).toBe(0);
      await expect.poll(() => entry.exited).toBe(true);
      expect(resolveWorktreeSession(fixture.repo, fixture.repo)).toBeNull();
    });
  }
);
