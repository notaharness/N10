/**
 * beam stream — the friendly per-stream handle both sides of a connection
 * get, whether they opened it or the peer did. See docs/beam.md.
 */

/** Who is on the other end of the connection this stream rides on. Set once
 * per connection and identical for every stream on it, whether this side
 * opened the stream or the peer did — it is what lets a handler answer "who
 * is calling me" (A4's injected environment) and what a per-connection cache
 * keys itself on (A1's PTY session map). */
export interface StreamContext {
  /** The peer machine at the other end of this connection. */
  peerId: string;
  /** That peer's label, as this machine knows it right now. */
  label: string;
}

export interface BeamStream {
  readonly id: number;
  readonly name: string;
  /** The peer this stream's connection is with. */
  readonly peer: StreamContext;
  /** Parsed JSON open parameters (D1): the fields of a `{`-prefixed Open
   * payload other than `name`. Undefined for a bare stream-name Open, or for
   * a stream this side opened without params. */
  readonly openParams?: Record<string, unknown>;
  write(data: Uint8Array): void;
  /** Send a connection-level Control message scoped to this stream (e.g. a
   * pty resize); the muxer stamps `streamId` on it. */
  control(message: Record<string, unknown>): void;
  close(reason?: string): void;
  onData(handler: (data: Uint8Array) => void): void;
  onClose(handler: (reason?: string) => void): void;
  /** Connection-level Control messages scoped to this stream (a pty resize,
   * an ack) — everything that is not stream data. */
  onControl(handler: (message: Record<string, unknown>) => void): void;
}

/** What BeamStreamImpl sends through; supplied by the owning Muxer so the
 * stream itself never touches frame encoding or the transport. */
export interface StreamSink {
  sendData(streamId: number, data: Uint8Array): void;
  sendClose(streamId: number, reason?: string): void;
  sendControl(message: Record<string, unknown>): void;
}

export class BeamStreamImpl implements BeamStream {
  /** @internal set by the Muxer while a locally-opened stream awaits ack. */
  readyResolve: ((stream: BeamStream) => void) | null = null;
  /** @internal ditto. */
  readyReject: ((error: Error) => void) | null = null;
  /** @internal the open-ack timer, so it can be cleared as soon as the
   * outcome is known instead of firing uselessly later. */
  readyTimer: ReturnType<typeof setTimeout> | null = null;

  private dataHandlers: ((data: Uint8Array) => void)[] = [];
  private closeHandlers: ((reason?: string) => void)[] = [];
  private controlHandlers: ((message: Record<string, unknown>) => void)[] = [];
  private ended = false;

  constructor(
    private readonly sink: StreamSink,
    readonly id: number,
    readonly name: string,
    readonly peer: StreamContext,
    readonly openParams?: Record<string, unknown>
  ) {}

  write(data: Uint8Array): void {
    this.sink.sendData(this.id, data);
  }

  control(message: Record<string, unknown>): void {
    this.sink.sendControl({ ...message, streamId: this.id });
  }

  /** Sends Close to the peer and tears this side down immediately — a
   * stream we closed locally must not linger in the muxer's live set, or a
   * later reused id could spuriously collide with it. */
  close(reason?: string): void {
    this.sink.sendClose(this.id, reason);
    this.emitClose(reason);
  }

  onData(handler: (data: Uint8Array) => void): void {
    this.dataHandlers.push(handler);
  }

  onClose(handler: (reason?: string) => void): void {
    this.closeHandlers.push(handler);
  }

  onControl(handler: (message: Record<string, unknown>) => void): void {
    this.controlHandlers.push(handler);
  }

  /** @internal fed by the Muxer on an incoming Data frame. */
  emitData(data: Uint8Array): void {
    for (const handler of this.dataHandlers) handler(data);
  }

  /** @internal fed by the Muxer on an incoming Close frame, or on dispose. */
  emitClose(reason?: string): void {
    if (this.ended) return;
    this.ended = true;
    for (const handler of this.closeHandlers) handler(reason);
  }

  /** @internal fed by the Muxer on a Control message scoped to this stream. */
  emitControl(message: Record<string, unknown>): void {
    for (const handler of this.controlHandlers) handler(message);
  }
}
