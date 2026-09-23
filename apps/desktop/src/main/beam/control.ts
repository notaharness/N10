import { connect as netConnect, type Socket } from 'node:net';
import { LineDecoder, MAX_CONTROL_LINE } from './wire.js';

/** A failed op: one of beam docs/06's error tokens, and its detail. */
export class BeamOpError extends Error {
  constructor(readonly code: string, readonly detail: string) {
    super(detail ? `beam: ${code}: ${detail}` : `beam: ${code}`);
    this.name = 'BeamOpError';
  }
}

interface Reply {
  id?: unknown;
  ok?: boolean;
  result?: unknown;
  error?: string;
  detail?: string;
  event?: string;
  data?: unknown;
}

type EventListener = (event: string, data: unknown) => void;

/** A listener's throw is reported, not raised out of the socket's
 *  handler, where it would be uncaught in the main process and stop
 *  the listeners after it. */
function guarded(listener: () => void): void {
  try {
    listener();
  } catch (err) {
    console.error('[beam] event listener', err);
  }
}

/** Opens a Unix socket connection, resolving once it is connected. */
export function openSocket(path: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = netConnect(path);
    const fail = (err: Error) => reject(err);
    socket.once('error', fail);
    socket.once('connect', () => {
      socket.off('error', fail);
      resolve(socket);
    });
  });
}

/**
 * One control connection to the beam daemon (beam docs/06): flat
 * `{ id, op, …fields }` requests answered out of order by id, and
 * `{ event, data }` lines for whatever this connection subscribed to.
 */
export class ControlConnection {
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private readonly listeners = new Set<EventListener>();
  private readonly closeListeners = new Set<() => void>();
  private readonly lines = new LineDecoder(MAX_CONTROL_LINE);
  private ended = false;

  private constructor(private readonly socket: Socket) {
    socket.on('data', (chunk: Buffer) => this.receive(chunk));
    socket.on('error', () => socket.destroy());
    socket.on('close', () => this.finish());
  }

  static async connect(socketPath: string): Promise<ControlConnection> {
    return new ControlConnection(await openSocket(socketPath));
  }

  request<T>(op: string, fields: Record<string, unknown> = {}): Promise<T> {
    if (this.ended) {
      return Promise.reject(new Error('beam: the control connection closed'));
    }
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
      });
      this.socket.write(`${JSON.stringify({ ...fields, id, op })}\n`);
    });
  }

  onEvent(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Fires once, when the connection ends for any reason. */
  onClose(listener: () => void): void {
    if (this.ended) listener();
    else this.closeListeners.add(listener);
  }

  close(): void {
    this.socket.destroy();
  }

  private receive(chunk: Buffer): void {
    let lines: string[];
    try {
      lines = this.lines.push(chunk);
    } catch {
      this.socket.destroy();
      return;
    }
    for (const line of lines) this.dispatch(line);
  }

  private dispatch(line: string): void {
    let reply: Reply;
    try {
      reply = JSON.parse(line) as Reply;
    } catch {
      this.socket.destroy();
      return;
    }
    if (typeof reply.event === 'string') {
      for (const listener of this.listeners) {
        guarded(() => listener(reply.event as string, reply.data));
      }
      return;
    }
    const waiter =
      typeof reply.id === 'number' ? this.pending.get(reply.id) : undefined;
    if (!waiter) return;
    this.pending.delete(reply.id as number);
    if (reply.ok) waiter.resolve(reply.result ?? {});
    else
      waiter.reject(
        new BeamOpError(reply.error ?? 'internal', reply.detail ?? '')
      );
  }

  private finish(): void {
    if (this.ended) return;
    this.ended = true;
    const closed = new Error('beam: the control connection closed');
    for (const waiter of this.pending.values()) waiter.reject(closed);
    this.pending.clear();
    for (const listener of this.closeListeners) guarded(listener);
    this.closeListeners.clear();
  }
}
