/**
 * A small client for `$BEAM_DIR/run/inbox.sock` (docs/beam.md's "Local
 * IPC"): line-delimited JSON over a Unix domain socket. The library ships
 * the server half (`IpcSocket`); this is the CLI's half.
 */

import { createConnection, type Socket } from 'node:net';

/** True only if something is actively listening on `path` right now — the
 * same liveness test `IpcSocket` itself uses before touching a stale
 * socket file. Never throws; a closed socket and "nothing there" look the
 * same to a caller deciding whether to fall back to an ephemeral node. */
export function connectToRunningNode(
  path: string,
  timeoutMs = 300
): Promise<Socket | null> {
  return new Promise((resolve) => {
    const socket = createConnection(path);
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(null);
    }, timeoutMs);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
  });
}

/** Send one request, read back exactly one line as the response — the
 * shape `{"op":"send",...}` / `{"op":"status"}` both use. */
export function requestOnce(
  socket: Socket,
  request: Record<string, unknown>
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const cleanup = (): void => {
      socket.removeListener('data', onData);
      socket.removeListener('error', onError);
    };
    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString('utf8');
      const newlineAt = buffer.indexOf('\n');
      if (newlineAt < 0) return;
      cleanup();
      try {
        resolve(
          JSON.parse(buffer.slice(0, newlineAt)) as Record<string, unknown>
        );
      } catch (error) {
        reject(error as Error);
      }
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    socket.on('data', onData);
    socket.once('error', onError);
    socket.write(`${JSON.stringify(request)}\n`);
  });
}

/** A persistent line reader/writer over an already-connected socket, for
 * `msg listen`'s subscribe-then-ack loop, where request and response are
 * not paired one-for-one. */
export class IpcLineClient {
  private buffer = '';

  constructor(
    private readonly socket: Socket,
    private readonly onLine: (line: Record<string, unknown>) => void
  ) {
    socket.on('data', (chunk: Buffer) => this.feed(chunk));
  }

  private feed(chunk: Buffer): void {
    this.buffer += chunk.toString('utf8');
    let newlineAt: number;
    while ((newlineAt = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newlineAt);
      this.buffer = this.buffer.slice(newlineAt + 1);
      if (!line.trim()) continue;
      try {
        this.onLine(JSON.parse(line) as Record<string, unknown>);
      } catch {
        // Not a line this protocol produced — ignore rather than crash the
        // CLI over a malformed line from an untrusted local process.
      }
    }
  }

  send(payload: Record<string, unknown>): void {
    this.socket.write(`${JSON.stringify(payload)}\n`);
  }

  close(): void {
    this.socket.end();
  }
}
