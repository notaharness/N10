import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { spawn as spawnPty, type IPty } from 'node-pty';
import type { ControlMessage, SpawnRequest } from './protocol.js';
import { createPtyQueue, stopPty } from './pty-lifecycle.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// dist/main.js → walk up to workspace root (dist → apps/cli-wterm-host → apps → root)
const workspaceRoot = path.resolve(__dirname, '..', '..', '..');
const cliBinary = path.resolve(workspaceRoot, 'apps/cli/dist/main.js');
const publicDir = path.resolve(__dirname, 'public');
const PORT = Number(process.env.PORT ?? 5174);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json',
};

// Single active PTY — we run workers=1, so multiplexing sessions was
// architectural speculation we don't need. Ring buffer preserves recent
// output so a late/reconnecting client can replay the terminal state
// (critical for surviving the browser's 1001 close during cold start).
const BUFFER_MAX_BYTES = 2 * 1024 * 1024;
let activePty: IPty | null = null;
let hasSpawned = false;
const queuePty = createPtyQueue();
let outputBuffer: Buffer[] = [];
let outputBufferSize = 0;
const clients = new Set<WebSocket>();

function appendBuffer(chunk: Buffer): void {
  outputBuffer.push(chunk);
  outputBufferSize += chunk.length;
  while (outputBufferSize > BUFFER_MAX_BYTES && outputBuffer.length > 1) {
    const dropped = outputBuffer.shift();
    if (dropped) outputBufferSize -= dropped.length;
  }
}

function clearBuffer(): void {
  outputBuffer = [];
  outputBufferSize = 0;
}

async function killActivePty(): Promise<void> {
  if (activePty) await stopPty(activePty);
}

async function spawnN10(req: SpawnRequest): Promise<void> {
  await killActivePty();
  clearBuffer();

  console.log(
    `[pty] spawn: node ${cliBinary} --tui ${req.repoPath} (HOME=${req.homeDir})`
  );
  // Ink disables its interactive TTY renderer when CI-env-vars are set, so
  // n10 produces no output under Playwright's webServer (which inherits
  // CI=true). Strip them for the spawned PTY so n10 paints normally.
  const childEnv: Record<string, string | undefined> = {
    ...process.env,
    TERM: 'xterm-256color',
    ...req.env,
    HOME: req.homeDir,
    // A tmux server keeps the environment it was started with, and an
    // every n10 spawn uses tmux, so it needs a socket inside its own
    // HOME, which its owner deletes on teardown.
    //
    // Last, and not negotiable: the host also auto-spawns a dev-default
    // session with no `env` at all, and a caller spreading its own
    // additions after this key would silently undo it. Without it a
    // server started here keeps the temp HOME for its whole life and
    // hands it to every session it later spawns, so one test run
    // poisons real sessions long after it ends (it did, once).
    TMUX_TMPDIR: req.homeDir,
  };
  delete childEnv.CI;
  delete childEnv.CONTINUOUS_INTEGRATION;
  delete childEnv.GITHUB_ACTIONS;
  // A tmux client reads the socket path straight out of `$TMUX` and
  // ignores `TMUX_TMPDIR` when it is set, so a host started from inside
  // a tmux session hands the spawned n10 the *developer's* tmux
  // server — where it would create (and the tests would fail to find)
  // its sessions. Nothing here should ever be nested in a real session.
  delete childEnv.TMUX;
  delete childEnv.TMUX_PANE;

  const pty = spawnPty('node', [cliBinary, '--tui', req.repoPath], {
    name: 'xterm-256color',
    cols: req.cols ?? 100,
    rows: req.rows ?? 30,
    cwd: workspaceRoot,
    env: childEnv as Record<string, string>,
  });
  activePty = pty;
  console.log(`[pty] spawned pid=${pty.pid}`);

  let firstDataLogged = false;
  pty.onData((data) => {
    if (!firstDataLogged) {
      console.log(`[pty] first data (${data.length} bytes)`);
      firstDataLogged = true;
    }
    const buf = Buffer.from(data, 'utf8');
    appendBuffer(buf);
    for (const ws of clients) {
      if (ws.readyState === ws.OPEN) {
        ws.send(buf, { binary: true });
      }
    }
  });
  pty.onExit(({ exitCode, signal }) => {
    console.log(`[pty] exited code=${exitCode} signal=${signal ?? '-'}`);
    if (activePty === pty) {
      activePty = null;
    }
  });
}

async function spawnDevDefault(): Promise<void> {
  const home = execSync(`mktemp -d "${tmpdir()}/n10-wterm-dev-home.XXXXXX"`)
    .toString()
    .trim();
  const repo = execSync(`mktemp -d "${tmpdir()}/n10-wterm-dev-repo.XXXXXX"`)
    .toString()
    .trim();
  execSync('git init', { cwd: repo, stdio: 'pipe' });
  execSync('git config user.email "dev@n10.dev"', {
    cwd: repo,
    stdio: 'pipe',
  });
  execSync('git config user.name "n10 Dev"', { cwd: repo, stdio: 'pipe' });
  execSync('git commit --allow-empty -m "initial"', {
    cwd: repo,
    stdio: 'pipe',
  });
  execSync(`mkdir -p "${path.join(home, '.n10')}"`, { stdio: 'pipe' });
  await spawnN10({ repoPath: repo, homeDir: home });
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function serveStatic(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  const urlPath = new URL(req.url ?? '/', 'http://localhost').pathname;
  const relPath = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const filePath = path.resolve(publicDir, relPath);
  if (!filePath.startsWith(publicDir + path.sep) && filePath !== publicDir) {
    res.writeHead(403).end('forbidden');
    return;
  }
  try {
    const st = await stat(filePath);
    if (!st.isFile()) throw new Error('not a file');
    const ext = path.extname(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(await readFile(filePath));
  } catch {
    res.writeHead(404).end('not found');
  }
}

// Security posture: trusted-localhost-only. /spawn, /kill, and WS /pty are
// unauthenticated by design. The server binds to `localhost` below and this
// host is intended for dev + Playwright (workers=1). Do not expose the port
// beyond loopback without adding auth — /spawn accepts an arbitrary repoPath
// and env, which is equivalent to local code execution for any caller.
const server = http.createServer((req, res) => {
  // `createServer` expects a void-returning listener. Handing it an
  // async function gives it a promise it never looks at, so anything
  // rejecting past the try blocks below — `serveStatic` hitting a bad
  // path, say — became an unhandled rejection that takes the host down
  // mid-test instead of a 500. Route the failure to the response.
  void handleRequest(req, res).catch((err: unknown) => {
    console.error('[http] handler failed', err);
    if (!res.headersSent) res.writeHead(500);
    res.end('internal error');
  });
});

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

  if (req.method === 'POST' && url.pathname === '/spawn') {
    try {
      const body = await readBody(req);
      const parsed = JSON.parse(body) as SpawnRequest;
      if (!parsed.repoPath || !parsed.homeDir) {
        res.writeHead(400).end('missing repoPath or homeDir');
        return;
      }
      hasSpawned = true;
      await queuePty(() => spawnN10(parsed));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(400).end((err as Error).message);
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/kill') {
    await queuePty(async () => {
      await killActivePty();
      clearBuffer();
    });
    res.writeHead(200).end('ok');
    return;
  }

  if (req.method === 'GET' && handleGetJson(url.pathname, res)) return;

  if (req.method !== 'GET') {
    res.writeHead(405).end('method not allowed');
    return;
  }

  await serveStatic(req, res);
}

/**
 * The read-only JSON GET endpoints. Returns true when it answered.
 *
 * `/output` hands back the raw PTY ring buffer (base64) — the browser
 * terminal can't render kitty graphics or synthesise mouse reports, so
 * e2e tests read the bytes here to assert on the escape sequences
 * n10 emitted (kitty APC payloads, DECSET mouse toggles).
 */
function handleGetJson(pathname: string, res: http.ServerResponse): boolean {
  const json = (body: unknown) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (pathname === '/status') {
    json({ ptyAlive: activePty != null });
    return true;
  }
  if (pathname === '/output') {
    json({ base64: Buffer.concat(outputBuffer).toString('base64') });
    return true;
  }
  return false;
}

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  if (url.pathname !== '/pty') {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, handleWs);
});

function handleWs(ws: WebSocket): void {
  console.log('[ws] connected');
  clients.add(ws);

  // Only an initial manual visit gets a dev session. A reconnect after
  // /kill must not create another process during fixture teardown.
  if (!hasSpawned) {
    hasSpawned = true;
    void queuePty(spawnDevDefault).catch((error) => {
      console.error('[pty] dev spawn failed', error);
    });
  }

  // Replay buffered output so this client catches up.
  for (const chunk of outputBuffer) {
    ws.send(chunk, { binary: true });
  }

  ws.on('message', (raw, isBinary) => {
    if (!activePty) return;
    const buf = Array.isArray(raw)
      ? Buffer.concat(raw)
      : Buffer.from(raw as ArrayBuffer);
    if (isBinary) {
      activePty.write(buf.toString('utf8'));
      return;
    }
    try {
      const msg = JSON.parse(buf.toString('utf8')) as ControlMessage;
      if (msg.type === 'resize') {
        activePty.resize(msg.cols, msg.rows);
      }
    } catch {
      /* ignore */
    }
  });

  ws.on('close', (code, reason) => {
    console.log(
      `[ws] disconnected code=${code} reason=${reason.toString() || '-'}`
    );
    clients.delete(ws);
    // PTY intentionally stays alive across WS close.
  });
}

function shutdown(): void {
  void queuePty(killActivePty).then(
    () => process.exit(0),
    (error) => {
      console.error('[pty] shutdown failed', error);
      process.exit(1);
    }
  );
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, 'localhost', () => {
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : PORT;
  console.log(`listening on http://localhost:${port}`);
});
