import { execFileSync, spawn, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { postToClaudeSession } from './claude-inbox.js';

const ID = '3f2b9c1e-7a4d-4e8b-9c0f-1a2b3c4d5e6f';

let dir: string;
let server: Server | null;
let received: Promise<string>;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'n10-claude-'));
  mkdirSync(join(dir, 'sessions'));
  server = null;
});
afterEach(async () => {
  await new Promise<void>((resolve) =>
    server ? server.close(() => resolve()) : resolve()
  );
  rmSync(dir, { recursive: true, force: true });
});

/** A process's start time, Claude's `procStart`, read as Orchestra's
 *  shell reads it rather than by the parser under test. */
function procStart(pid: number): string {
  return execFileSync(
    'sh',
    ['-c', `sed 's/.*) //' /proc/${pid}/stat | awk '{print $20}'`],
    { encoding: 'utf8' }
  ).trim();
}

const machineId = ['/etc/machine-id', '/var/lib/dbus/machine-id'].find(
  existsSync
);

/** Listens on an inbox socket; `received` settles with the first
 *  connection's bytes. */
async function listen(): Promise<string> {
  const socket = join(dir, 'inbox.sock');
  received = new Promise((resolve) => {
    server = createServer((conn) => {
      let data = '';
      conn.on('data', (chunk) => (data += chunk.toString()));
      conn.on('end', () => resolve(data));
    });
  });
  await new Promise<void>((resolve) => server!.listen(socket, resolve));
  return socket;
}

function register(pid: number, entry: Record<string, unknown>): void {
  writeFileSync(
    join(dir, 'sessions', `${pid}.json`),
    JSON.stringify({ pid, sessionId: ID, ...entry })
  );
}

describe('postToClaudeSession', () => {
  it('posts one user frame to the live session’s inbox socket', async () => {
    const socket = await listen();
    register(process.pid, {
      messagingSocketPath: socket,
      procStart: procStart(process.pid),
    });
    await expect(postToClaudeSession(ID, 'report: done', [dir])).resolves.toBe(
      'delivered'
    );
    expect(await received).toBe(
      `${JSON.stringify({
        type: 'user',
        message: { role: 'user', content: 'report: done' },
      })}\n`
    );
  });

  it('finds a session in the pid namespace it names', async () => {
    const socket = await listen();
    register(process.pid, {
      messagingSocketPath: socket,
      pidDomain: machineId
        ? `linux:${readFileSync(machineId, 'utf8').trim()}:${readlinkSync(
            `/proc/${process.pid}/ns/pid`
          )}`
        : 'unknown',
    });
    await expect(postToClaudeSession(ID, 'x', [dir])).resolves.toBe(
      'delivered'
    );
  });

  it('parses the start time of a process whose name holds “) ”', async () => {
    const socket = await listen();
    const sleeper = join(dir, 'x) y (z');
    copyFileSync(
      execFileSync('sh', ['-c', 'command -v sleep'], {
        encoding: 'utf8',
      }).trim(),
      sleeper
    );
    const child = spawn(sleeper, ['30'], { stdio: 'ignore' });
    try {
      register(child.pid!, {
        messagingSocketPath: socket,
        procStart: procStart(child.pid!),
      });
      await expect(postToClaudeSession(ID, 'x', [dir])).resolves.toBe(
        'delivered'
      );
    } finally {
      child.kill();
    }
  });

  it('finds no session when none is registered under that id', async () => {
    await expect(postToClaudeSession(ID, 'x', [dir])).resolves.toBe(
      'unregistered'
    );
  });

  it('looks in every config directory it is given', async () => {
    const socket = await listen();
    register(process.pid, { messagingSocketPath: socket });
    await expect(
      postToClaudeSession(ID, 'x', [join(dir, 'elsewhere'), dir])
    ).resolves.toBe('delivered');
  });

  it('never posts to another session’s inbox', async () => {
    const socket = await listen();
    register(process.pid, {
      messagingSocketPath: socket,
      sessionId: '00000000-0000-4000-8000-000000000000',
    });
    await expect(postToClaudeSession(ID, 'x', [dir])).resolves.toBe(
      'unregistered'
    );
  });

  it('does not take a recycled pid for the session that held it', async () => {
    const socket = await listen();
    register(process.pid, { messagingSocketPath: socket, procStart: '1' });
    await expect(postToClaudeSession(ID, 'x', [dir])).resolves.toBe('not-live');
  });

  it.skipIf(!machineId)(
    'does not take a pid from another pid namespace',
    async () => {
      const socket = await listen();
      register(process.pid, {
        messagingSocketPath: socket,
        pidDomain: 'linux:someone-else:pid:[1]',
      });
      await expect(postToClaudeSession(ID, 'x', [dir])).resolves.toBe(
        'not-live'
      );
    }
  );

  it('does not take an exited process for a live session', async () => {
    const socket = await listen();
    register(2 ** 22 + 7, { messagingSocketPath: socket });
    await expect(postToClaudeSession(ID, 'x', [dir])).resolves.toBe('not-live');
  });

  it('skips an entry that is not an object', async () => {
    writeFileSync(join(dir, 'sessions', '1.json'), 'null');
    await expect(postToClaudeSession(ID, 'x', [dir])).resolves.toBe(
      'unregistered'
    );
  });

  it('fails when nothing listens on the live session’s socket', async () => {
    // A socket file left behind by a process that died listening.
    const socket = join(dir, 'stale.sock');
    spawnSync(process.execPath, [
      '-e',
      `require('net').createServer().listen(${JSON.stringify(
        socket
      )}, () => process.kill(process.pid, 'SIGKILL'))`,
    ]);
    register(process.pid, { messagingSocketPath: socket });
    await expect(postToClaudeSession(ID, 'x', [dir])).resolves.toBe('not-live');
  });
});
