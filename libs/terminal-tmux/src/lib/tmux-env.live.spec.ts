import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SessionBackend } from '@n10/terminal';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { assertScratchTmuxSocket } from '../../vitest.setup.js';
import { createTmuxBackend } from './tmux-backend.js';

const backends: SessionBackend[] = [];
let dir: string;
beforeAll(assertScratchTmuxSocket);
afterEach(() => {
  for (const backend of backends.splice(0)) backend.kill();
  rmSync(dir, { recursive: true, force: true });
});

async function readWhenWritten(file: string): Promise<string> {
  const deadline = Date.now() + 5000;
  for (;;) {
    try {
      const text = readFileSync(file, 'utf8');
      if (text.endsWith('\n')) return text.trim();
    } catch {
      // not yet
    }
    if (Date.now() > deadline) throw new Error(`${file} was never written`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe('a hosted process’s environment', () => {
  it('has the PATH the launch pinned, not the launching process’s', async () => {
    dir = mkdtempSync(join(tmpdir(), 'n10-tmux-env-'));
    const out = join(dir, 'path');
    const name = `env-${process.pid}-${Date.now()}`;
    const backend = await createTmuxBackend(
      {
        cmd: '/bin/sh',
        args: ['-c', `echo "$PATH" > '${out}'; sleep 30`],
        cwd: dir,
        cols: 80,
        rows: 24,
        env: { PATH: `/n10-session-bin:${process.env['PATH'] ?? ''}` },
      },
      { mode: 'create', label: name, tags: {}, retainOnExit: false }
    );
    backends.push(backend);
    expect(await readWhenWritten(out)).toMatch(/^\/n10-session-bin:/);
  });
});
