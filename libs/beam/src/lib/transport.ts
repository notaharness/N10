/**
 * beam transport — the pluggable byte pipe a Muxer rides on. WebSocket ships
 * in Phase 1; a WebRTC data channel or a relay can implement the same three
 * methods later without touching anything above this layer.
 */

import WebSocket from 'ws';
import { MAX_TRANSPORT_MESSAGE_BYTES } from './protocol.js';

export interface TransportSocket {
  send(data: Uint8Array): void;
  /** Close politely: the graceful handshake the protocol defines, which
   * needs the peer to play along to complete. Right for an ordinary
   * shutdown; not right when the peer has just lost the right to be here. */
  close(code?: number): void;
  /**
   * Drop the connection now, without waiting for the peer. Every transport
   * must offer this: a graceful close is a request the far end can simply
   * ignore — `ws` waits out its 30s `closeTimeout` while inbound frames keep
   * arriving — and revocation cannot be a request. See `PeerConnection.terminate`.
   */
  terminate(): void;
  onData(handler: (data: Uint8Array) => void): void;
  onClose(handler: () => void): void;
  /**
   * Send a transport-level liveness probe, answered by the far end's
   * transport rather than by its application code. Optional: a transport
   * with no probe of its own gets no liveness monitor, and a connection
   * over it can only learn of a peer that closes politely. See
   * `liveness.ts`, and `PeerConnection.checkAlive` for what a caller can
   * ask of it.
   */
  ping?(): void;
  /** Called on every answer to `ping()`. Required alongside it — a probe
   * nobody can hear the answer to proves nothing. */
  onPong?(handler: () => void): void;
}

export interface Transport {
  /** Open a socket to `url`; resolves when the connection is live. */
  connect(url: string): Promise<TransportSocket>;
}

/** WebSocket transport over ws(s):// endpoints. */
export class WebSocketTransport implements Transport {
  connect(url: string): Promise<TransportSocket> {
    return new Promise((resolve, reject) => {
      // Same cap as the host's server (see host.ts): one frame, header
      // included. `ws` otherwise buffers up to 100 MiB of a single message
      // before anything can look at its declared length.
      const socket = new WebSocket(url, {
        maxPayload: MAX_TRANSPORT_MESSAGE_BYTES,
      });
      socket.binaryType = 'nodebuffer';

      const onOpen = () => {
        socket.off('error', onEarlyError);
        resolve(wrapWebSocket(socket));
      };
      const onEarlyError = (error: Error) => {
        socket.off('open', onOpen);
        reject(new Error(`socket to ${url} failed: ${error.message}`));
      };
      socket.once('open', onOpen);
      socket.once('error', onEarlyError);
    });
  }
}

/** Wrap an already-open `ws` socket (client or server side — the `ws`
 * package uses the same class for both) as a TransportSocket. Shared with
 * the host's WebSocket upgrade handler so both sides of a connection build
 * their Muxer the same way.
 *
 * The underlying `message` listener is attached immediately, before any
 * consumer calls `onData` — not lazily inside it. On the dialing side,
 * `dial()` does `await transport.connect(url)` before wiring a Muxer to the
 * result, which leaves a real gap between the WebSocket's `open` event and
 * `onData` actually being called; a peer that sends the instant a
 * connection completes (exactly what the mailbox flusher does when mail is
 * already queued) would otherwise have that first frame silently dropped,
 * since `EventEmitter` never queues an event for a listener that is not
 * yet attached. Frames that arrive before any `onData` handler is
 * registered are buffered and flushed to it in order once one is. */
export function wrapWebSocket(socket: WebSocket): TransportSocket {
  const dataHandlers: ((data: Uint8Array) => void)[] = [];
  const closeHandlers: (() => void)[] = [];
  const buffered: Uint8Array[] = [];

  socket.on('message', (data, isBinary) => {
    if (!isBinary) return;
    const bytes = new Uint8Array(data as Buffer);
    if (dataHandlers.length === 0) {
      buffered.push(bytes);
      return;
    }
    for (const handler of dataHandlers) handler(bytes);
  });
  const notifyClose = (): void => {
    for (const handler of closeHandlers) handler();
  };
  socket.on('close', notifyClose);
  // A late error after `open` should still end the connection rather than
  // leaving callers waiting on data that will never arrive.
  socket.on('error', notifyClose);

  return {
    send: (data) => socket.send(data),
    close: (code) => socket.close(code ?? 1000),
    // `ws.terminate()` destroys the underlying socket immediately instead of
    // sending a Close frame and waiting for the peer's, so a peer that
    // ignores the handshake gets no window at all.
    terminate: () => socket.terminate(),
    onData: (handler) => {
      dataHandlers.push(handler);
      if (buffered.length === 0) return;
      for (const bytes of buffered.splice(0, buffered.length)) handler(bytes);
    },
    onClose: (handler) => closeHandlers.push(handler),
    // A WebSocket ping is answered by the peer's `ws` layer itself, so a
    // pong says the far end's event loop is running — the one question a
    // socket that stays ESTABLISHED under a dead machine cannot answer.
    // `ws` throws on a send after close, and a socket that is already
    // going away is the close path's business, not the monitor's.
    ping: () => {
      if (socket.readyState !== WebSocket.OPEN) return;
      socket.ping();
    },
    onPong: (handler) => {
      socket.on('pong', () => handler());
    },
  };
}
