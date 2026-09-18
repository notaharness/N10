import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { MachineExecutor } from '@n10/terminal-tmux';
import {
  listOurSessionsWith,
  resolveWorktreeSession,
} from './session-resolver.js';

/**
 * `listOurSessionsWith` against a real tmux server through a real
 * `MachineExecutor` (an async `execFile`, exactly the shape
 * `beam-node-remote-ops.ts`'s `execOn` hands `open-session.ts`) rather
 * than a mock — the seam finding 7's fix depends on, and the review's
 * named second-weakest spot: "the remote transport is only ever a
 * mock". This does not exercise a real beam connection (that stays
 * mocked; see open-session.spec.ts), only that the argv this resolver
 * sends and the columns it parses are what a real tmux actually
 * returns when run through an executor rather than a direct fork.
 */

function tmuxAvailable(): boolean {
  try {
    execFileSync('tmux', ['-V'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const SKIP = !tmuxAvailable();
const execFileAsync = promisify(execFile);

/** A `MachineExecutor` over the *same* scratch tmux server the sync
 *  resolver's own tests use, reached asynchronously — standing in for
 *  a beam `exec` round trip without needing a real beam pair for this
 *  one op. */
const executor: MachineExecutor = {
  async run(argv) {
    try {
      const { stdout, stderr } = await execFileAsync(argv[0]!, argv.slice(1));
      return { stdout, stderr, code: 0 };
    } catch (error) {
      const err = error as { stdout?: string; stderr?: string; code?: number };
      return {
        stdout: err.stdout ?? '',
        stderr: err.stderr ?? String(error),
        code: err.code ?? 1,
      };
    }
  },
};

const created: string[] = [];
const RUN = `${process.pid}-${Date.now().toString(36)}-remote`;
const name = (label: string) => `resolver-remote-${RUN}-${label}`;

function startSession(sessionName: string, tags: Record<string, string>): void {
  execFileSync('tmux', [
    'new-session',
    '-d',
    '-s',
    sessionName,
    '--',
    '/bin/sh',
    '-c',
    'sleep 30',
  ]);
  created.push(sessionName);
  for (const [key, value] of Object.entries(tags)) {
    execFileSync('tmux', ['set-option', '-t', `=${sessionName}:`, key, value]);
  }
}

function tags(repo: string, branch: string): Record<string, string> {
  return {
    '@orchestra-spawner': 'n10',
    '@orchestra-repo': repo,
    '@orchestra-session-type': 'worktree',
    '@orchestra-branch': branch,
  };
}

beforeAll(() => {
  if (SKIP) return;
  if (
    process.env.TMUX ||
    !process.env.TMUX_TMPDIR?.includes('n10-core-tests-')
  ) {
    throw new Error(
      'refusing to run against a tmux socket that is not the scratch one'
    );
  }
});

afterEach(() => {
  while (created.length > 0) {
    const sessionName = created.pop()!;
    try {
      execFileSync('tmux', ['kill-session', '-t', `=${sessionName}:`], {
        stdio: 'ignore',
      });
    } catch {
      /* already gone */
    }
  }
});

describe.skipIf(SKIP)(
  'listOurSessionsWith (finding 7, a real executor)',
  () => {
    const REPO = `/repos/remote-${RUN}`;

    it('finds a tagged session through an async executor, one round trip', async () => {
      startSession(name('a'), tags(REPO, 'feat/remote'));
      const sessions = await listOurSessionsWith(executor);
      expect(
        resolveWorktreeSession(REPO, 'feat/remote', sessions)
      ).toMatchObject({ name: name('a'), repo: REPO, branch: 'feat/remote' });
    });

    it('does not find an untagged session sharing the name n10 would allocate', async () => {
      startSession(`remote-${RUN}-untagged`, {});
      const sessions = await listOurSessionsWith(executor);
      expect(sessions.map((s) => s.name)).not.toContain(
        `remote-${RUN}-untagged`
      );
    });

    it('answers an empty list rather than throwing when the executor call itself fails', async () => {
      const failing: MachineExecutor = {
        run: () => Promise.reject(new Error('connection reset')),
      };
      await expect(listOurSessionsWith(failing)).resolves.toEqual([]);
    });
  }
);
