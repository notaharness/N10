import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FrameDecoder,
  LineDecoder,
  MAX_CONTROL_LINE,
  encodeFrame,
  encodeJsonFrame,
  type Frame,
  type FrameType,
} from '../wire.js';

/**
 * A scriptable stand-in for `beam daemon`'s control socket (beam docs/06),
 * speaking the real byte formats over a real Unix socket so the client is
 * tested end to end below its ports.
 */

export class FakeOpError extends Error {
  constructor(readonly code: string, readonly detail = '') {
    super(code);
  }
}

export type Request = Record<string, unknown> & { id: number; op: string };

export class FakeControl {
  readonly requests: Request[] = [];
  constructor(readonly socket: Socket) {}
  send(value: unknown): void {
    this.socket.write(`${JSON.stringify(value)}\n`);
  }
  emit(event: string, data: unknown): void {
    this.send({ event, data });
  }
  destroy(): void {
    this.socket.destroy();
  }
}

export class FakeAttach {
  readonly frames: Frame[] = [];
  private readonly listeners = new Set<(frame: Frame) => void>();
  constructor(readonly streamId: string, readonly socket: Socket) {}
  receive(frame: Frame): void {
    this.frames.push(frame);
    for (const listener of this.listeners) listener(frame);
  }
  onFrame(listener: (frame: Frame) => void): void {
    this.listeners.add(listener);
  }
  send(type: FrameType, payload: Buffer | string): void {
    this.socket.write(encodeFrame(type, Buffer.from(payload)));
  }
  sendJson(type: FrameType, value: unknown): void {
    this.socket.write(encodeJsonFrame(type, value));
  }
  /** Frames of `type` received so far, payloads as JSON. */
  json(type: FrameType): unknown[] {
    return this.frames
      .filter((f) => f.type === type)
      .map((f) => JSON.parse(f.payload.toString()) as unknown);
  }
}

type OpHandler = (req: Request, conn: FakeControl) => unknown;

export class FakeDaemon {
  readonly controls: FakeControl[] = [];
  readonly attaches: FakeAttach[] = [];
  private readonly handlers = new Map<string, OpHandler>();
  private attachHandler: ((attach: FakeAttach) => void) | null = null;
  private readonly sockets = new Set<Socket>();

  private constructor(
    private readonly server: Server,
    private readonly dir: string,
    readonly socketPath: string
  ) {}

  /** Listens in a fresh temp directory, or at `socketPath` when given
   *  (a directory the caller owns). */
  static async start(at?: string): Promise<FakeDaemon> {
    const dir = at ? '' : mkdtempSync(join(tmpdir(), 'n10-beam-'));
    const socketPath = at ?? join(dir, 'beam.sock');
    const server = createServer();
    const daemon = new FakeDaemon(server, dir, socketPath);
    server.on('connection', (socket) => daemon.accept(socket));
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));
    return daemon;
  }

  /** Answer `op` with the handler's return value, or its thrown
   *  `FakeOpError`. An op with no handler answers `{}`. */
  on(op: string, handler: OpHandler): void {
    this.handlers.set(op, handler);
  }

  onAttach(handler: (attach: FakeAttach) => void): void {
    this.attachHandler = handler;
  }

  requests(op: string): Request[] {
    return this.controls.flatMap((c) => c.requests.filter((r) => r.op === op));
  }

  /** Broadcast an event on every live control connection. */
  emit(event: string, data: unknown): void {
    for (const c of this.controls) if (!c.socket.destroyed) c.emit(event, data);
  }

  async close(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
    if (this.dir) rmSync(this.dir, { recursive: true, force: true });
  }

  private accept(socket: Socket): void {
    this.sockets.add(socket);
    socket.on('close', () => this.sockets.delete(socket));
    socket.on('error', () => undefined);
    const lines = new LineDecoder(MAX_CONTROL_LINE);
    let attach: FakeAttach | null = null;
    let control: FakeControl | null = null;
    const frames = new FrameDecoder();
    socket.on('data', (chunk: Buffer) => {
      if (attach) {
        for (const f of frames.push(chunk)) attach.receive(f);
        return;
      }
      const newline = chunk.indexOf(0x0a);
      if (!control && newline !== -1) {
        const first = JSON.parse(chunk.subarray(0, newline).toString()) as {
          attach?: string;
        };
        if (first.attach) {
          attach = new FakeAttach(first.attach, socket);
          this.attaches.push(attach);
          this.attachHandler?.(attach);
          for (const f of frames.push(chunk.subarray(newline + 1)))
            attach.receive(f);
          return;
        }
      }
      control ??= this.newControl(socket);
      for (const line of lines.push(chunk)) {
        this.handle(control, JSON.parse(line) as Request);
      }
    });
  }

  private newControl(socket: Socket): FakeControl {
    const control = new FakeControl(socket);
    this.controls.push(control);
    return control;
  }

  private handle(control: FakeControl, req: Request): void {
    control.requests.push(req);
    const handler = this.handlers.get(req.op) ?? (() => ({}));
    Promise.resolve()
      .then(() => handler(req, control))
      .then(
        (result) => control.send({ id: req.id, ok: true, result }),
        (err: unknown) => {
          const e =
            err instanceof FakeOpError ? err : new FakeOpError('internal');
          control.send({
            id: req.id,
            ok: false,
            error: e.code,
            detail: e.detail,
          });
        }
      );
  }
}
