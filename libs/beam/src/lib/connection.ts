/**
 * beam peer connection — the symmetric handle either side of a live
 * connection gets, whether this machine dialed or accepted. See docs/beam.md
 * and libs/beam/src/lib/muxer.ts for the framing underneath it.
 */

import {
  startLiveness,
  type LivenessMonitor,
  type LivenessOptions,
} from './liveness.js';
import { Muxer, type MuxerRole } from './muxer.js';
import type { StreamScope } from './peer-scopes.js';
import type { StreamOpenHandler, StreamRegistry } from './stream-registry.js';
import type { BeamStream } from './stream.js';
import type { TransportSocket } from './transport.js';

export interface PeerConnection {
  /** The machine at the other end. */
  readonly peerId: string;
  openStream(
    name: string,
    params?: Record<string, unknown>
  ): Promise<BeamStream>;
  /** Register the handler for streams the peer opens. Shared with every
   * other connection built against the same registry, so a later phase can
   * register `exec` or `msg` once and have it apply everywhere. */
  onStream(name: string, handler: StreamOpenHandler): void;
  /** `reason` distinguishes an ordinary close from a transport that ended
   * mid-frame ("truncated...", A7's FrameDecoder.finish() wiring). */
  onClose(cb: (reason: string) => void): void;
  /** Ordinary, polite shutdown: reap the streams, then ask the transport to
   * close gracefully. The peer decides when the socket actually dies. */
  close(): void;
  /**
   * Revocation's close. Reap the streams, then drop the transport without
   * waiting for the peer to agree — `close()` leaves a hostile peer the
   * whole of `ws`'s 30s close timeout, during which its frames are still
   * delivered. Taking access back is not a request, so it does not go
   * through a handshake the far end can decline.
   */
  terminate(reason?: string): void;
  /**
   * Ask the transport for a liveness round trip right now, and resolve
   * with whether the peer answered inside `timeoutMs` (default: the
   * monitor's own pong timeout). A frame arriving from the peer while
   * the question is outstanding answers it too — see `liveness.ts`.
   *
   * For a caller that is about to *rely* on this connection — a
   * reconnect, a manual retry — and cannot afford the periodic timer's
   * worst case. A connection whose transport has no probe at all, or one
   * already closed, answers `false`: an unverifiable connection is
   * suspect, which is the safe direction for the one caller this exists
   * for.
   */
  checkAlive(timeoutMs?: number): Promise<boolean>;
}

export interface CreateConnectionOptions {
  peerId: string;
  /** The peer's label, as this machine knows it right now. Defaults to
   * `peerId` for callers (mostly tests) that have no label handy. */
  label?: string;
  role: MuxerRole;
  socket: TransportSocket;
  registry: StreamRegistry;
  /** What this peer is entitled to open here, asked afresh on every
   * inbound `Open` (see `MuxerOptions.scopes`). Both `Host` and `dial`
   * pass a live lookup into their own peer table, which is what makes a
   * grant a property of the peer rather than of this connection: it is
   * re-read after a reconnect exactly as it is mid-connection. */
  scopes?: () => readonly StreamScope[];
  /**
   * Ping/pong liveness over the transport (`liveness.ts`). On by default
   * with the module's own interval and timeout; `false` turns it off, for
   * a caller driving both ends itself with no real socket between them.
   */
  liveness?: LivenessOptions | false;
}

/** Wire a transport socket to a Muxer and present the result as a
 * PeerConnection. Identical for a dialed connection and an accepted one —
 * that symmetry is what lets Phase 2 drain a mailbox over whichever
 * connection exists, regardless of which side opened it. */
export function createConnection(
  options: CreateConnectionOptions
): PeerConnection {
  const { socket, registry } = options;
  const muxer = new Muxer(registry, {
    role: options.role,
    sendBytes: (bytes) => socket.send(bytes),
    peer: { peerId: options.peerId, label: options.label ?? options.peerId },
    scopes: options.scopes,
  });
  const closeHandlers: ((reason: string) => void)[] = [];
  let closed = false;
  let monitor: LivenessMonitor | null = null;

  const finish = (reason: string): void => {
    if (closed) return;
    closed = true;
    monitor?.stop();
    muxer.dispose(reason);
    for (const cb of closeHandlers) cb(reason);
  };

  // A peer that stops answering is dropped, not asked to leave: there is
  // nobody on the other end to complete a close handshake, and `ws` would
  // sit out its 30s close timeout waiting for one. Same reasoning as
  // revocation's `terminate`, for the opposite reason — there the peer
  // will not answer, here it cannot.
  const { ping, onPong } = socket;
  if (options.liveness !== false && ping && onPong) {
    monitor = startLiveness(
      { ping: () => ping.call(socket), onPong: (h) => onPong.call(socket, h) },
      options.liveness ?? {},
      (reason) => {
        finish(`connection lost: ${reason}`);
        socket.terminate();
      }
    );
  }

  socket.onData((data) => {
    // A frame from the peer answers the liveness question as well as a
    // pong does, and arrives where a pong cannot: behind a backlog. The
    // monitor is told before the muxer runs, so a handler that throws
    // cannot cost the connection its evidence of life.
    monitor?.noteInbound();
    if (!muxer.receive(data)) socket.close();
  });
  socket.onClose(() => {
    // Wire FrameDecoder.finish() into the real transport-end path (A7): a
    // connection that died mid-frame is reported as truncated, not as a
    // quiet, ordinary close.
    let reason = 'connection closed';
    try {
      muxer.finishTransport();
    } catch (error) {
      reason = `connection closed: ${(error as Error).message}`;
    }
    finish(reason);
  });

  return {
    peerId: options.peerId,
    openStream: (name, params) => muxer.openStream(name, params),
    onStream: (name, handler) => registry.register(name, handler),
    onClose: (cb) => closeHandlers.push(cb),
    close: () => {
      finish('closed locally');
      socket.close();
    },
    // `finish` is idempotent, so the transport's own 'close' event arriving
    // afterwards is a no-op. That is only safe because nothing can enter
    // the Muxer's stream map after `dispose`: `openStream` throws, and
    // `receive`/`handleOpen` drop inbound frames once disposed. Without
    // those guards a peer could open streams in the gap between `finish`
    // and the socket actually dying, and the second `finish` would return
    // early and never reap them.
    terminate: (reason) => {
      finish(reason ?? 'terminated locally');
      socket.terminate();
    },
    checkAlive: (timeoutMs) =>
      monitor?.checkAlive(timeoutMs) ?? Promise.resolve(false),
  };
}
