/**
 * beam host — the machine-resident half of pairing and streaming: a
 * node:http server for the auth surface (see host-routes.ts), a `ws`
 * WebSocket server for the stream connection. Payload never travels over
 * HTTP. See docs/beam.md.
 */

import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { Socket } from 'node:net';
import { WebSocketServer } from 'ws';
import { MutualAuth, verifySignature } from './auth.js';
import { ConnectionRegistry } from './connection-registry.js';
import { createConnection } from './connection.js';
import { wsTranscript } from './handshake-transcript.js';
import { sendJson } from './http-json.js';
import {
  DESCRIPTOR_PATH,
  PROTOCOL_VERSION,
  handleChallenge,
  handleDescriptor,
  handlePair,
  handleRtc,
  handleSession,
  type HostDescriptor,
  type RouteContext,
} from './host-routes.js';
import type { Identity } from './identity.js';
import type { LivenessOptions } from './liveness.js';
import type { PeerRecord, PeerTable } from './peer-table.js';
import { MAX_TRANSPORT_MESSAGE_BYTES } from './protocol.js';
import { PAIRING_TOKEN_TTL_MS, SingleUseSecrets } from './secrets.js';
import { StreamRegistry } from './stream-registry.js';
import { wrapWebSocket } from './transport.js';

export { DESCRIPTOR_PATH, PROTOCOL_VERSION, type HostDescriptor };

export interface HostOptions {
  identity: Identity;
  peers: PeerTable;
  registry?: StreamRegistry;
  connections?: ConnectionRegistry;
  /** Default '127.0.0.1'. Any other value is a deliberate, logged choice. */
  hostname?: string;
  /** Default 0 (OS-assigned ephemeral port). */
  port?: number;
  /** Where peers may dial this machine back; told to a pairing caller. */
  endpoints?: string[];
  capabilities?: string[];
  now?: () => number;
  log?: (message: string) => void;
  /** Ping/pong liveness for every connection this host accepts
   * (`liveness.ts`). A client that vanishes mid-session otherwise leaves
   * its shells, its `exec` children and its per-peer budget held until
   * it reconnects and `ConnectionRegistry.add` supersedes it. */
  liveness?: LivenessOptions | false;
}

export class Host {
  readonly identity: Identity;
  readonly peers: PeerTable;
  readonly registry: StreamRegistry;
  readonly connections: ConnectionRegistry;

  private readonly hostnameOption: string;
  private readonly portOption: number;
  private readonly log: (message: string) => void;
  private readonly ctx: RouteContext;
  private readonly liveness?: LivenessOptions | false;
  private server: Server | null = null;
  private wss: WebSocketServer | null = null;

  constructor(options: HostOptions) {
    this.identity = options.identity;
    this.peers = options.peers;
    this.registry = options.registry ?? new StreamRegistry();
    this.connections = options.connections ?? new ConnectionRegistry();
    this.hostnameOption = options.hostname ?? '127.0.0.1';
    this.portOption = options.port ?? 0;
    this.log = options.log ?? ((message) => console.log(`[beam] ${message}`));
    this.liveness = options.liveness;
    this.ctx = {
      identity: this.identity,
      peers: this.peers,
      auth: new MutualAuth({
        peers: this.peers,
        hostPeerId: this.identity.peerId,
        privateKeyPem: this.identity.privateKeyPem,
        now: options.now,
      }),
      pairingTokens: new SingleUseSecrets(PAIRING_TOKEN_TTL_MS, options.now),
      endpoints: options.endpoints ?? [],
      capabilities: options.capabilities ?? ['streams'],
      log: this.log,
    };
  }

  get hostname(): string {
    return this.hostnameOption;
  }

  get port(): number {
    const address = this.server?.address();
    if (!address || typeof address === 'string')
      throw new Error('host is not listening');
    return address.port;
  }

  get baseUrl(): string {
    return `http://${this.hostname}:${this.port}`;
  }

  /**
   * Update the endpoints this host tells a pairing caller it may be
   * dialed back on. Separate from the constructor because the real
   * bound address (an ephemeral `port: 0` resolves after `listen()`)
   * is not known until then — a caller typically calls this once,
   * right after `listen()` resolves, with its own `baseUrl`.
   */
  setEndpoints(endpoints: string[]): void {
    this.ctx.endpoints = endpoints;
  }

  /** Mint a bare one-time pairing token (10 min TTL). */
  issuePairingToken(): string {
    return this.ctx.pairingTokens.issue(undefined);
  }

  /** Mint a token plus the ready-to-share pair URL carrying it in the hash,
   * which keeps it out of request lines, proxy logs, and Referer headers. */
  issuePairingUrl(): { token: string; url: string } {
    const token = this.issuePairingToken();
    return { token, url: `${this.baseUrl}/pair#token=${token}` };
  }

  listen(): Promise<void> {
    if (
      this.hostnameOption !== '127.0.0.1' &&
      this.hostnameOption !== 'localhost'
    ) {
      this.log(
        `binding non-loopback interface ${this.hostnameOption} — this exposes the node to that network`
      );
    }
    this.server = createServer((req, res) => {
      this.handleRequest(req, res).catch(() =>
        sendJson(res, 500, { error: 'internal error' })
      );
    });
    // Without a cap, `ws` allows 100 MiB per message: a peer could make
    // this process allocate and concatenate all of it before the frame
    // decoder ever saw the length field it would have rejected.
    this.wss = new WebSocketServer({
      noServer: true,
      maxPayload: MAX_TRANSPORT_MESSAGE_BYTES,
    });
    this.server.on('upgrade', (req, socket, head) =>
      this.handleUpgrade(req, socket as Socket, head)
    );
    return new Promise((resolve, reject) => {
      this.server?.once('error', reject);
      this.server?.listen(this.portOption, this.hostnameOption, () =>
        resolve()
      );
    });
  }

  close(): Promise<void> {
    for (const connection of this.connections.list()) connection.close();
    this.wss?.close();
    return new Promise((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close(() => resolve());
    });
  }

  private async handleRequest(
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://internal');
    if (req.method === 'GET' && url.pathname === DESCRIPTOR_PATH)
      return handleDescriptor(this.ctx, res);
    if (req.method === 'POST' && url.pathname === '/pair')
      return handlePair(this.ctx, req, res);
    if (req.method === 'GET' && url.pathname.startsWith('/challenge/')) {
      return handleChallenge(
        this.ctx,
        url.pathname.slice('/challenge/'.length),
        res
      );
    }
    if (req.method === 'POST' && url.pathname === '/session')
      return handleSession(this.ctx, req, res);
    if (req.method === 'POST' && url.pathname === '/rtc') return handleRtc(res);
    sendJson(res, 404, { error: 'not found' });
  }

  /**
   * The `'upgrade'` listener is synchronous, and an upgrade is reached
   * before any authentication: no ticket, no proof, no pairing. A throw out
   * of here escapes the `'upgrade'` emit and takes the whole node down,
   * dropping every other peer's connection and the shells running on them,
   * for the price of one TCP connection. Parsing alone can throw — a
   * request-target `new URL()` rejects (`//[::1`, `http://[`, `//:`) is a
   * well-formed HTTP request line as far as the parser is concerned — and
   * `socket.on('error')` does not catch it, because a thrown exception is
   * not an `'error'` event. The HTTP path is already covered by
   * `handleRequest(...).catch(...)` in `listen()`.
   *
   * The guard wraps the whole body rather than just the parse, the way
   * `Muxer.failStream` contains a stream handler, so anything added to the
   * upgrade path later inherits it without anyone remembering to.
   */
  private handleUpgrade(
    req: IncomingMessage,
    socket: Socket,
    head: Buffer
  ): void {
    // A client that resets the connection while we are still writing a
    // rejection (bad path, unknown/revoked peer) or destroying the socket
    // must not crash the node with an unhandled 'error' (D3's audit). `ws`
    // attaches its own listener once we reach `wss.handleUpgrade()`; this
    // covers the rejection paths that return before that point, and is
    // attached before anything that can throw.
    socket.on('error', () => undefined);
    try {
      this.routeUpgrade(req, socket, head);
    } catch {
      this.refuseUpgrade(socket, '400 Bad Request');
    }
  }

  /** Write a bare HTTP refusal and drop the socket. Nothing above the
   * refused socket is affected. */
  private refuseUpgrade(socket: Socket, refusal: string): void {
    try {
      socket.write(`HTTP/1.1 ${refusal}\r\n\r\n`);
    } catch {
      // The socket is already gone; destroying it is all that is left.
    }
    socket.destroy();
  }

  private routeUpgrade(
    req: IncomingMessage,
    socket: Socket,
    head: Buffer
  ): void {
    const url = new URL(req.url ?? '/', 'http://internal');
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }
    const authorized = this.authorizeUpgrade(url);
    if ('refusal' in authorized) {
      this.refuseUpgrade(socket, authorized.refusal);
      return;
    }
    const { peerId, peer } = authorized;
    this.wss?.handleUpgrade(req, socket, head, (ws) => {
      const connection = createConnection({
        peerId,
        label: peer.label,
        role: 'acceptor',
        socket: wrapWebSocket(ws),
        registry: this.registry,
        liveness: this.liveness,
      });
      this.connections.add(connection);
      this.peers.touch(peerId);
    });
  }

  /**
   * Ticket possession alone is not authorisation. The transport is not
   * encrypted, so anyone on the path reads the ticket off the wire and can
   * race the legitimate client for it. The caller also signs the ticket
   * with the private key behind the public key this machine stored at
   * pairing time, and that proof is verified **before** the ticket is
   * consumed — consume first and an attacker who read the ticket could
   * spend it with a garbage proof and burn the legitimate client's.
   * `MutualAuth.proveSession` applies exactly this rule to the challenge.
   *
   * The peerId comes from the ticket, never from the caller: a
   * caller-supplied id would let an attacker choose which key their own
   * proof is checked against.
   */
  private authorizeUpgrade(
    url: URL
  ): { peerId: string; peer: PeerRecord } | { refusal: string } {
    const ticket = url.searchParams.get('ticket') ?? '';
    const proof = url.searchParams.get('proof') ?? '';
    const peerId = this.ctx.auth.peekTicket(ticket);
    const claimed = peerId ? this.peers.get(peerId) : undefined;
    const proven =
      claimed !== undefined &&
      verifySignature(
        claimed.publicKeyPem,
        wsTranscript(
          { hostPeerId: this.identity.peerId, clientPeerId: claimed.peerId },
          ticket
        ),
        proof
      );
    if (!peerId || !proven) return { refusal: '401 Unauthorized' };
    try {
      this.ctx.auth.consumeTicket(ticket);
    } catch {
      return { refusal: '401 Unauthorized' };
    }
    // A5: revocation inside the ticket's 30s window must still take effect —
    // the ticket alone is not enough to trust; re-check the peer is still
    // in good standing at the moment the upgrade actually happens.
    const peer = this.peers.get(peerId);
    if (!peer || peer.revoked) return { refusal: '403 Forbidden' };
    return { peerId, peer };
  }

  /** Revoke a peer and drop its live connection, if any (A5) — revocation
   * that does not close an already-open connection is not really
   * revocation. `terminate`, not `close`: a graceful close is a handshake
   * the revoked peer can simply decline, and it keeps opening shells for as
   * long as it declines. */
  revoke(peerId: string): void {
    this.peers.revoke(peerId);
    this.connections.get(peerId)?.terminate('peer revoked');
  }
}
