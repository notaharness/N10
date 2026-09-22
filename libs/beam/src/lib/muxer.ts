/**
 * beam muxer — turns raw transport bytes into stream events and back, for
 * one connection. Works identically whether this side dialed or accepted,
 * which is what lets Phase 2's mailbox drain over whichever connection
 * exists regardless of who opened it. See docs/beam.md.
 */

import { parseOpenPayload } from './open-params.js';
import { openRefusal } from './open-gate.js';
import { streamCloseError, type StreamScope } from './peer-scopes.js';
import {
  FrameDecoder,
  FrameType,
  ProtocolError,
  SeqSender,
  SeqTracker,
  decodeText,
  encodeFrame,
  frameStreamId,
  type Frame,
} from './protocol.js';
import { StreamIdAllocator } from './stream-ids.js';
import {
  BeamStreamImpl,
  type BeamStream,
  type StreamContext,
  type StreamSink,
} from './stream.js';
import type { StreamRegistry } from './stream-registry.js';
import type { MuxerRole } from './muxer-role.js';

export type { MuxerRole };

const encoder = new TextEncoder();

/** How long a locally-opened stream waits for the peer's ack before the
 * promise from `openStream` rejects. */
const OPEN_ACK_TIMEOUT_MS = 10_000;

/** Used when a caller (tests, mostly) builds a Muxer without a peer
 * context — production call sites (connection.ts) always supply one. */
const UNKNOWN_PEER: StreamContext = { peerId: 'unknown', label: 'unknown' };

export interface MuxerOptions {
  /** 'initiator' (the side that dialed) allocates odd stream ids, 'acceptor'
   * even ones, so the two directions can never collide when either side may
   * open a stream. */
  role: MuxerRole;
  sendBytes: (bytes: Uint8Array) => void;
  /** Who is on the other end of this connection; stamped onto every stream
   * this Muxer creates (D1/A1/A4). */
  peer?: StreamContext;
  /**
   * What that peer is entitled to open here. Asked on every inbound `Open`
   * rather than captured once, so it reads the peer table as it is at that
   * moment: a grant narrowed by a re-pair, or a `reload-peers` picking one
   * up from another process, takes effect on the live connection, the same
   * way revocation does. Omitted (tests, and a caller with no peer table)
   * means unconstrained, so nothing that worked before this existed stops
   * working.
   */
  scopes?: () => readonly StreamScope[];
}

export class Muxer {
  private readonly decoder = new FrameDecoder();
  private readonly sender = new SeqSender();
  private readonly tracker = new SeqTracker();
  private readonly streams = new Map<number, BeamStreamImpl>();
  private readonly sink: StreamSink;
  private readonly registry: StreamRegistry;
  private readonly sendBytes: (bytes: Uint8Array) => void;
  private readonly peer: StreamContext;
  private readonly scopes?: () => readonly StreamScope[];
  private readonly ids: StreamIdAllocator;
  private disposed = false;

  constructor(registry: StreamRegistry, options: MuxerOptions) {
    this.registry = registry;
    this.sendBytes = options.sendBytes;
    this.peer = options.peer ?? UNKNOWN_PEER;
    this.scopes = options.scopes;
    this.ids = new StreamIdAllocator(options.role);
    this.sink = {
      sendData: (streamId, data) =>
        this.sendFrame(FrameType.Data, streamId, data),
      sendClose: (streamId, reason) => {
        // A locally-initiated close must not linger in `streams`: the peer
        // will not send one back, and nothing else would ever remove it.
        this.streams.delete(streamId);
        this.sendFrame(
          FrameType.Close,
          streamId,
          reason === undefined ? new Uint8Array(0) : encoder.encode(reason)
        );
      },
      sendControl: (message) =>
        this.sendFrame(
          FrameType.Control,
          0,
          encoder.encode(JSON.stringify(message))
        ),
    };
  }

  /**
   * Open a named stream and wait for the peer to acknowledge it. The ack
   * callbacks must be wired up *before* the Open frame is sent: a transport
   * that delivers synchronously (as a same-process wired pair does in
   * tests) can round-trip the peer's response before a `new Promise`
   * executor would otherwise get a chance to run.
   *
   * `params`, if given, travels in the same frame as the name (D1): there is
   * no longer a follow-up Data frame, which is what used to let an open
   * payload be typed into whatever `stream.onData` was already wired to.
   */
  async openStream(
    name: string,
    params?: Record<string, unknown>
  ): Promise<BeamStream> {
    if (this.disposed) throw new Error('connection is closed');
    const id = this.ids.allocate((streamId) => this.streams.has(streamId));
    const payload = params
      ? encoder.encode(JSON.stringify({ name, ...params }))
      : encoder.encode(name);
    // Encode before registering anything. Encoding is what enforces the
    // wire's limits, and a map entry plus a live timer for a stream that
    // was never sent would sit there with nothing left to reap them.
    // `async` so that failure reaches the caller as the rejection this
    // signature has always promised, rather than as a synchronous throw at
    // the call site.
    const bytes = encodeFrame({
      type: FrameType.Open,
      streamId: id,
      seq: this.sender.peek(id),
      payload,
    });
    this.sender.claim(id);

    const stream = new BeamStreamImpl(this.sink, id, name, this.peer, params);
    this.streams.set(id, stream);

    let resolveReady!: (value: BeamStream) => void;
    let rejectReady!: (error: Error) => void;
    const ready = new Promise<BeamStream>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    stream.readyResolve = resolveReady;
    stream.readyReject = rejectReady;

    const timer = setTimeout(() => {
      if (stream.readyReject !== rejectReady) return;
      this.streams.delete(id);
      stream.readyResolve = null;
      stream.readyReject = null;
      stream.readyTimer = null;
      // Tell the peer too. It may well have opened the stream and spawned
      // a process behind it; dropping only this side's state leaves that
      // process running for the life of the connection, holding a slot in
      // that peer's MAX_PTY_SESSIONS budget that nothing will ever free.
      this.sendFrame(
        FrameType.Close,
        id,
        encoder.encode('open was never acknowledged')
      );
      rejectReady(new Error(`stream '${name}' was never acknowledged`));
    }, OPEN_ACK_TIMEOUT_MS);
    timer.unref?.();
    stream.readyTimer = timer;

    this.sendBytes(bytes);
    return ready;
  }

  /** Feed one inbound chunk of transport bytes. Malformed frames end the
   * connection's decode state but never throw into the caller, and neither
   * does a stream handler: a throw out of `handleFrame` fails only the
   * stream it belongs to.
   *
   * Bytes that arrive after `dispose` are dropped. A transport is not
   * guaranteed to be dead the moment we stop wanting it: a graceful
   * WebSocket close is a handshake the peer can decline, and `ws` keeps
   * delivering frames for the whole of its 30s close timeout while it
   * waits. A revoked peer must not be served out of that window. */
  receive(raw: Uint8Array): boolean {
    if (this.disposed) return true;
    let frames: Frame[];
    try {
      frames = this.decoder.push(raw);
    } catch (error) {
      return !(error instanceof ProtocolError);
    }
    for (const frame of frames) {
      try {
        this.handleFrame(frame);
      } catch (error) {
        this.failStream(frame, error);
      }
    }
    return true;
  }

  /** Call when the transport itself has ended, before `dispose`: surfaces a
   * `truncated` ProtocolError if bytes were left mid-frame, so a connection
   * that died mid-frame is distinguishable from one that just went quiet. */
  finishTransport(): void {
    this.decoder.finish();
  }

  /** Transport ended (close, error, or abrupt disconnect): reap every
   * stream so nothing is left running unobserved. */
  dispose(reason = 'connection closed'): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const [id, stream] of [...this.streams]) {
      this.streams.delete(id);
      this.clearReadyTimer(stream);
      if (stream.readyReject) {
        const reject = stream.readyReject;
        stream.readyResolve = null;
        stream.readyReject = null;
        reject(new Error(reason));
      } else {
        stream.emitClose(reason);
      }
    }
  }

  /**
   * A handler that throws fails only its own stream; the connection and
   * every other stream on it survive. `handleOpen` calls a registered
   * handler synchronously and `handleData`/`handleControl` run user
   * callbacks synchronously, so any of them can throw back into `receive`,
   * and an uncaught throw there is a kill switch any paired peer controls
   * the timing of. The guard lives here rather than in each handler so it
   * covers stream types added later without anyone remembering to add it.
   */
  private failStream(frame: Frame, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    const reason = `stream handler failed: ${message.split('\n')[0]}`;
    const streamId = frameStreamId(frame);
    const stream = this.streams.get(streamId);
    this.streams.delete(streamId);
    try {
      this.sendFrame(FrameType.Close, streamId, encoder.encode(reason));
    } catch {
      // The transport is already gone; the local teardown below still runs.
    }
    if (!stream) return;
    this.clearReadyTimer(stream);
    const reject = stream.readyReject;
    stream.readyResolve = null;
    stream.readyReject = null;
    try {
      if (reject) reject(new Error(reason));
      else stream.emitClose(reason);
    } catch {
      // A close handler that throws as well has nothing left to fail.
    }
  }

  private clearReadyTimer(stream: BeamStreamImpl): void {
    if (!stream.readyTimer) return;
    clearTimeout(stream.readyTimer);
    stream.readyTimer = null;
  }

  private handleFrame(frame: Frame): void {
    switch (frame.type) {
      case FrameType.Open:
        this.handleOpen(frame);
        return;
      case FrameType.Data:
        this.handleData(frame);
        return;
      case FrameType.Close:
        this.handleClose(frame);
        return;
      case FrameType.Control:
        this.handleControl(frame);
        return;
    }
  }

  private handleOpen(frame: Frame): void {
    const { name, params } = parseOpenPayload(decodeText(frame));
    // One list, in open-gate.ts: a connection already reaped, a stream id
    // that is not the opener's to allocate, an id already in use, and a
    // stream kind this peer was not granted. Everything refusable about an
    // Open lives there, because this is the frame whose effect — a spawned
    // process — outlives the connection.
    const refusal = openRefusal(
      {
        disposed: this.disposed,
        ownedByPeer: this.ids.belongsToPeer(frame.streamId),
        alreadyOpen: this.streams.has(frame.streamId),
        granted: this.scopes?.(),
      },
      name
    );
    if (refusal) {
      this.sendFrame(FrameType.Close, frame.streamId, encoder.encode(refusal));
      return;
    }
    // `seq` counts every frame on this stream, not just Data (SeqSender
    // claims it uniformly for Open/Data/Close) — the tracker must see the
    // Open frame's seq too, or it will expect the first Data frame to start
    // back at 0 and flag it as a gap.
    this.tracker.feed(frame.streamId, frame.seq);
    const handler = this.registry.resolve(name);
    if (!handler) {
      this.sendFrame(
        FrameType.Close,
        frame.streamId,
        encoder.encode(`unsupported stream: ${name}`)
      );
      return;
    }
    const stream = new BeamStreamImpl(
      this.sink,
      frame.streamId,
      name,
      this.peer,
      params
    );
    this.streams.set(frame.streamId, stream);
    handler(stream);
  }

  private handleData(frame: Frame): void {
    const stream = this.streams.get(frame.streamId);
    if (!stream) return;
    const verdict = this.tracker.feed(frame.streamId, frame.seq);
    if (verdict === 'duplicate') return; // Already delivered; drop silently.
    if (verdict === 'gap' || verdict === 'reorder') {
      // We cannot know what was lost or how to reassemble it; delivering
      // this frame as if it were the next one would corrupt whatever the
      // stream carries. Fail the stream rather than deliver bad data.
      this.streams.delete(frame.streamId);
      stream.emitClose(`frame sequence error: ${verdict}`);
      return;
    }
    stream.emitData(frame.payload);
  }

  private handleClose(frame: Frame): void {
    const stream = this.streams.get(frame.streamId);
    if (!stream) return;
    this.streams.delete(frame.streamId);
    this.clearReadyTimer(stream);
    const reason = frame.payload.byteLength > 0 ? decodeText(frame) : undefined;
    if (stream.readyReject) {
      const reject = stream.readyReject;
      stream.readyResolve = null;
      stream.readyReject = null;
      // A refusal for want of a scope comes back as its own error type, so
      // the caller never has to tell it from a dead transport by reading a
      // message: one is permanent, the other is worth retrying.
      reject(streamCloseError(reason, stream.name));
      return;
    }
    stream.emitClose(reason);
  }

  private handleControl(frame: Frame): void {
    if (frame.payload.byteLength === 0) return;
    let message: unknown;
    try {
      message = JSON.parse(decodeText(frame));
    } catch {
      return; // Malformed control messages are ignored, never fatal.
    }
    if (typeof message !== 'object' || message === null) return;
    const record = message as Record<string, unknown>;
    const streamId = record['streamId'];
    if (typeof streamId !== 'number') return;
    const stream = this.streams.get(streamId);
    if (!stream) return;
    if (record['kind'] === 'opened' && stream.readyResolve) {
      const resolve = stream.readyResolve;
      stream.readyResolve = null;
      stream.readyReject = null;
      this.clearReadyTimer(stream);
      resolve(stream);
      return;
    }
    stream.emitControl(record);
  }

  private sendFrame(
    type: Frame['type'],
    streamId: number,
    payload: Uint8Array
  ): void {
    // Encode first, claim second. A seq claimed for a frame that then
    // fails to encode (an oversized payload, say) is a hole in the
    // stream's sequence, and the peer reads a hole as lost data and fails
    // the stream — turning one unsendable frame into a dead stream.
    const bytes = encodeFrame({
      type,
      streamId,
      seq: this.sender.peek(streamId),
      payload,
    });
    this.sender.claim(streamId);
    this.sendBytes(bytes);
  }
}
