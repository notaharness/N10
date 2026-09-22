/**
 * Peers that are present but not answering — the shape of failure every
 * existing beam test is missing.
 *
 * Everything already covered is a *graceful, locally initiated* close:
 * `connection.close()`, a process exiting cleanly, a fake handle invoking
 * its own close callback, an endpoint that refuses the TCP connection
 * outright. Each of those ends with a FIN or an ECONNREFUSED, which every
 * layer above notices by itself. None of them can express the case that
 * actually breaks the system: a socket that stays ESTABLISHED while
 * nothing is left at the other end to answer on it.
 *
 * Two kinds of peer here, and the split is deliberate:
 *
 * - `startSilentPeer` / `startAnsweringPeer` run a real `ws` server in
 *   this process. Real TCP, real WebSocket framing, real ping frames —
 *   only the *reason* for the silence is synthetic (`autoPong: false`
 *   instead of a stopped event loop). Fast and deterministic, so they can
 *   carry the bulk of the assertions.
 * - `spawnFreezablePeer` runs the same server in a child process that
 *   `SIGSTOP` can actually freeze. Nothing in-process can reproduce an
 *   event loop that stops; that is exactly the condition the audit found
 *   beam blind to, so at least one test has to pay for a second process.
 *
 * A fake `TransportSocket` would have been cheaper than both and worth
 * nothing: the bug is that a real half-open socket looks identical to a
 * healthy one, and a fake is only ever as silent as its author remembered
 * to make it.
 *
 * A third failure — a peer that is healthy while the *link* is not — is
 * neither of these, and lives in `slow-link.ts`.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import WebSocketClient, { WebSocketServer, type WebSocket } from 'ws';
import { MAX_TRANSPORT_MESSAGE_BYTES } from '../lib/protocol.js';
import {
  wrapWebSocket,
  type Transport,
  type TransportSocket,
} from '../lib/transport.js';

export interface HostilePeer {
  url: string;
  /** Every socket this peer has accepted, in arrival order. */
  sockets: WebSocket[];
  /** Every application frame that reached this peer — what separates "the
   * bytes never arrived" from "they arrived at something that will never
   * answer". */
  received: Buffer[];
  /** Resolves once a client has connected. */
  accepted(): Promise<WebSocket>;
  close(): Promise<void>;
}

interface PeerOptions {
  /** Answer WebSocket pings. `false` is a peer whose transport is as dead
   * as a frozen machine's while its socket stays open. */
  autoPong: boolean;
  /** Echo application frames back. A peer that accepts data and never
   * answers it (`false`) is a different failure from one that cannot
   * answer a ping at all, and the two must not be conflated. An echo is
   * an answer in its own right — `liveness.ts` counts any inbound frame
   * — so only a peer meant to look alive should have one. */
  echo: boolean;
}

function startPeer(options: PeerOptions): Promise<HostilePeer> {
  const server = new WebSocketServer({ port: 0, autoPong: options.autoPong });
  const sockets: WebSocket[] = [];
  const received: Buffer[] = [];
  const waiters: ((socket: WebSocket) => void)[] = [];
  server.on('connection', (socket) => {
    socket.on('error', () => undefined);
    socket.on('message', (data, isBinary) => {
      if (!isBinary) return;
      received.push(data as Buffer);
      if (options.echo) socket.send(data as Buffer);
    });
    sockets.push(socket);
    for (const waiter of waiters.splice(0, waiters.length)) waiter(socket);
  });
  return new Promise((resolve) => {
    server.on('listening', () => {
      const address = server.address();
      const port = typeof address === 'string' ? 0 : address?.port;
      resolve({
        url: `ws://127.0.0.1:${port}`,
        sockets,
        received,
        accepted: () =>
          sockets.length > 0
            ? Promise.resolve(sockets[0] as WebSocket)
            : new Promise<WebSocket>((r) => waiters.push(r)),
        close: () =>
          new Promise((done) => {
            for (const socket of sockets) socket.terminate();
            server.close(() => done());
          }),
      });
    });
  });
}

/** Accepts, reads what it is sent, and answers nothing at all — no pong,
 * and no frames of its own either. Both halves matter: an inbound frame
 * counts as evidence of life (`liveness.ts`), so a peer that echoed would
 * be answering the question by another route, and "never answers a ping"
 * would no longer be what the test was varying. */
export function startSilentPeer(): Promise<HostilePeer> {
  return startPeer({ autoPong: false, echo: false });
}

/** Accepts, echoes, and answers pings — the control every "it dropped the
 * peer" assertion needs beside it, or the fix is indistinguishable from a
 * timer that drops everything. */
export function startAnsweringPeer(): Promise<HostilePeer> {
  return startPeer({ autoPong: true, echo: true });
}

/** Accepts and answers pings, but never reads application frames: a peer
 * whose *application* is wedged while its transport is healthy. */
export function startDeafPeer(): Promise<HostilePeer> {
  return startPeer({ autoPong: true, echo: false });
}

export interface FreezablePeer {
  url: string;
  /** Stop the peer's event loop. Its kernel keeps the socket alive and
   * keeps ACKing; nothing in the process answers anything. */
  freeze(): void;
  /** Let it run again. */
  thaw(): void;
  kill(): void;
}

/** A real, separately scheduled peer process: an echoing `ws` server that
 * `SIGSTOP` can freeze mid-stream and `SIGCONT` can resume. */
export async function spawnFreezablePeer(): Promise<FreezablePeer> {
  const child: ChildProcess = spawn(
    process.execPath,
    [
      '-e',
      `const { WebSocketServer } = require('ws');
       const server = new WebSocketServer({ port: 0 });
       server.on('connection', (socket) => {
         socket.on('error', () => {});
         socket.on('message', (data, isBinary) => {
           if (isBinary) socket.send(data);
         });
       });
       server.on('listening', () => {
         process.stdout.write(JSON.stringify({ port: server.address().port }) + '\\n');
       });`,
    ],
    { stdio: ['ignore', 'pipe', 'inherit'] }
  );
  const stdout = child.stdout;
  const pid = child.pid;
  if (!stdout || pid === undefined)
    throw new Error('peer process has no stdout or pid');
  const [first] = (await once(stdout, 'data')) as [Buffer];
  const { port } = JSON.parse(first.toString()) as { port: number };
  return {
    url: `ws://127.0.0.1:${port}`,
    freeze: () => process.kill(pid, 'SIGSTOP'),
    thaw: () => process.kill(pid, 'SIGCONT'),
    kill: () => {
      try {
        // SIGKILL reaches a stopped process, but a thaw first means the
        // child gets to run its exit rather than being counted as one
        // more suspended process if the kill ever races a restart.
        process.kill(pid, 'SIGCONT');
        process.kill(pid, 'SIGKILL');
      } catch {
        // Already gone.
      }
    },
  };
}

/**
 * A dialing side that authenticates normally and then stops answering —
 * the client half of the same failure, for testing what an *accepting*
 * machine does about it. `autoPong: false` is `ws`'s own switch for
 * "never answer a ping", which is what a client whose machine has gone
 * away looks like from the host's side of the socket.
 */
export function nonPongingTransport(): Transport {
  return {
    connect: (url: string): Promise<TransportSocket> =>
      new Promise((resolve, reject) => {
        const socket = new WebSocketClient(url, {
          autoPong: false,
          maxPayload: MAX_TRANSPORT_MESSAGE_BYTES,
        });
        socket.binaryType = 'nodebuffer';
        socket.once('open', () => resolve(wrapWebSocket(socket)));
        socket.once('error', reject);
      }),
  };
}
