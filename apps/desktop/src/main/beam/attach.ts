import type { Socket } from 'node:net';
import { openSocket } from './control.js';
import {
  FRAME,
  FrameDecoder,
  encodeFrame,
  encodeJsonFrame,
  type Frame,
} from './wire.js';

/** How a stream ended (beam docs/06, Streams): `exit` carries the
 *  process status; anything else is a refusal or a transport end. */
export interface StreamEnd {
  reason: string;
  detail?: string;
  exitCode?: number;
}

/** beam docs/04, Input: input frames outstanding before a `taken`. */
const INPUT_WINDOW = 4;

/**
 * One attach connection (beam docs/06): `{ "attach": streamId }`, then
 * frames both ways. Input — data and control frames alike — is held to
 * the daemon's window: at most four unanswered by `taken`, the rest
 * queued here, since a frame beyond it ends the stream `window`.
 */
export class AttachStream {
  private readonly frames = new FrameDecoder();
  private readonly queued: Buffer[] = [];
  private outstanding = 0;
  private endListeners = new Set<(end: StreamEnd) => void>();
  private ended: StreamEnd | null = null;
  private dataListener: (payload: Buffer) => void = () => undefined;

  private constructor(private readonly socket: Socket) {
    socket.on('data', (chunk: Buffer) => this.receive(chunk));
    socket.on('error', () => socket.destroy());
    socket.on('close', () => this.finish({ reason: 'connection-lost' }));
  }

  static async open(
    socketPath: string,
    streamId: string
  ): Promise<AttachStream> {
    const socket = await openSocket(socketPath);
    socket.write(`${JSON.stringify({ attach: streamId })}\n`);
    return new AttachStream(socket);
  }

  /** Output from the remote process; one listener. */
  onData(listener: (payload: Buffer) => void): void {
    this.dataListener = listener;
  }

  /** Fires once, with the stream's close frame or `connection-lost`. */
  onEnd(listener: (end: StreamEnd) => void): void {
    if (this.ended) listener(this.ended);
    else this.endListeners.add(listener);
  }

  sendData(payload: Buffer): void {
    this.input(encodeFrame(FRAME.data, payload));
  }

  sendControl(value: Record<string, unknown>): void {
    this.input(encodeJsonFrame(FRAME.control, value));
  }

  /** Detach: the remote side is closed and the stream ends `detached`.
   *  Input from here on is dropped; the close frame is the last one. */
  close(): void {
    if (this.ended || this.socket.writableEnded) return;
    this.queued.length = 0;
    this.socket.end(encodeJsonFrame(FRAME.close, { reason: 'detached' }));
  }

  private input(frame: Buffer): void {
    if (this.ended || this.socket.writableEnded) return;
    this.queued.push(frame);
    this.flush();
  }

  private flush(): void {
    while (this.outstanding < INPUT_WINDOW && this.queued.length > 0) {
      this.outstanding++;
      this.socket.write(this.queued.shift() as Buffer);
    }
  }

  private receive(chunk: Buffer): void {
    let frames: Frame[];
    try {
      frames = this.frames.push(chunk);
    } catch {
      this.socket.destroy();
      return;
    }
    for (const frame of frames) this.handle(frame);
  }

  private handle(frame: Frame): void {
    if (frame.type === FRAME.data) {
      this.dataListener(frame.payload);
      return;
    }
    const value = parseJson(frame.payload);
    if (frame.type === FRAME.close) {
      this.finish(toStreamEnd(value));
      this.socket.destroy();
    } else if (value?.kind === 'taken' && this.outstanding > 0) {
      this.outstanding--;
      this.flush();
    }
  }

  private finish(end: StreamEnd): void {
    if (this.ended) return;
    this.ended = end;
    this.queued.length = 0;
    for (const listener of this.endListeners) listener(end);
    this.endListeners.clear();
  }
}

function parseJson(payload: Buffer): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(payload.toString('utf8'));
    return value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function toStreamEnd(value: Record<string, unknown> | null): StreamEnd {
  const end: StreamEnd = {
    reason:
      typeof value?.reason === 'string' ? value.reason : 'connection-lost',
  };
  if (typeof value?.detail === 'string') end.detail = value.detail;
  if (typeof value?.exitCode === 'number') end.exitCode = value.exitCode;
  return end;
}
