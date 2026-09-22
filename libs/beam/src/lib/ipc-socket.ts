/**
 * The local IPC socket: `$BEAM_DIR/run/inbox.sock`, mode 0600,
 * line-delimited JSON. Any process on the machine can `send`, `subscribe`
 * or ask `status` without holding the identity itself. See docs/beam.md.
 */

import { existsSync, mkdirSync, unlinkSync } from 'node:fs';
import {
  createConnection,
  createServer,
  type Server,
  type Socket,
} from 'node:net';
import { dirname } from 'node:path';
import type { ConnectionRegistry } from './connection-registry.js';
import { writeLine } from './ipc-line.js';
import {
  handleForget,
  handleReloadPeers,
  handleRename,
  handleRevoke,
  type PeerOpContext,
} from './ipc-peer-ops.js';
import type { Envelope } from './mailbox/envelope.js';
import type { Mailbox, SendOutcome } from './mailbox/mailbox.js';
import type { PeerTable } from './peer-table.js';

/** Cap on one unterminated request line. The socket is line-delimited
 * JSON, and the largest legitimate line is a `send` carrying a 256 KiB
 * payload, so this is generous headroom — while keeping any local process
 * from growing this node's heap without bound simply by never sending a
 * newline. Counted in characters, each of which is at least one byte. */
const MAX_LINE_CHARS = 1024 * 1024;

interface Subscriber {
  socket: Socket;
  topic?: string;
  /** Only deliver envelopes from one of these senders — the server-side
   * half of `msg listen [<peer>...]` (decisions.md's Phase 3 review: a
   * client-side ack-and-discard filter is a special case of the durability
   * hole D15 fixes, and unnecessary besides, since `pump` below already
   * skips a non-matching envelope for the next subscriber instead of
   * blocking on it). Absent means "any sender". */
  from?: string[];
  /** This subscriber's own cursor: the one envelope it has been handed and
   * not yet acked. One slot per subscriber, never one for the node —
   * sequential delivery is a promise to each consumer about its own
   * stream, not a global lock. A single shared slot let one connected
   * subscriber that simply never acks hold up delivery to every other
   * subscriber, including ones filtered to a topic it does not even
   * receive. Its disconnect was handled; its silence was not, and silence
   * is what a wedged consumer looks like. */
  inFlight: PendingEnvelope | null;
}

/** One envelope still waiting on a subscriber ack, paired with the
 * `acknowledge()` that actually unlinks the mailbox's on-disk copy — see
 * Mailbox.subscribeInbound. Held here, not called, until a real subscriber
 * acks it over the wire: that gap is the whole point of the *subscriber*
 * ack being a distinct, later thing than the *wire* ack Mailbox already
 * gave the sender. */
interface PendingEnvelope {
  envelope: Envelope;
  acknowledge: () => void;
}

export interface IpcSocketOptions {
  path: string;
  mailbox: Mailbox;
  /** The live peer table this node's Host and Mailbox already share —
   * `revoke`/`rename`/`forget`/`reload-peers` act on this same instance, so
   * the change is visible to this node's own auth and delivery checks
   * immediately, not only after a restart re-reads peers.json. */
  peers: PeerTable;
  /** So `revoke`/`forget` can drop a peer's live connection (and, with it,
   * its open streams) the moment it is no longer trusted. */
  connections: ConnectionRegistry;
  /** This node's own bind address, already known by the time `serve`
   * constructs this (Host.listen() runs first) — reported back on the
   * `status` op so a separate CLI process can show it without a
   * CLI-private sidecar file. */
  bindAddress?: string;
  log?: (message: string) => void;
}

function toWireOutcome(outcome: SendOutcome): Record<string, unknown> {
  const { outcome: status, ...rest } = outcome;
  return { status, ...rest };
}

/** True if something is actively listening on `path` right now. */
function probeAlive(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection(path);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

/** Remove a stale socket file left by a crashed node — never one a live
 * node is still listening on, checked by actually trying to connect. */
async function removeStaleSocket(
  path: string,
  log: (message: string) => void
): Promise<void> {
  if (!existsSync(path)) return;
  if (await probeAlive(path)) {
    throw new Error(`a node is already listening on ${path}`);
  }
  log(`removing stale inbox socket at ${path}`);
  unlinkSync(path);
}

export class IpcSocket {
  private readonly path: string;
  private readonly mailbox: Mailbox;
  private readonly peers: PeerTable;
  private readonly connections: ConnectionRegistry;
  private readonly bindAddress?: string;
  private readonly log: (message: string) => void;
  private server: Server | null = null;
  private readonly subscribers: Subscriber[] = [];
  /** Envelopes accepted but not yet acknowledged by a subscriber, oldest
   * first. An envelope leaves this list only once acked — a subscriber
   * that disconnects mid-message puts it straight back. */
  private readonly pending: PendingEnvelope[] = [];
  private unsubscribeMailbox: (() => void) | null = null;

  constructor(options: IpcSocketOptions) {
    this.path = options.path;
    this.mailbox = options.mailbox;
    this.peers = options.peers;
    this.connections = options.connections;
    this.bindAddress = options.bindAddress;
    this.log = options.log ?? (() => undefined);
  }

  async listen(): Promise<void> {
    await removeStaleSocket(this.path, this.log);
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    this.server = createServer((socket) => this.handleConnection(socket));
    // The socket's mode grants message-sending to anything that can connect
    // to it. Chmod-ing it *after* listen() leaves a window at the platform
    // default (typically world-writable) between the bind and the chmod;
    // setting the umask around the bind itself means the file is created
    // 0600 atomically, with no window to close after the fact.
    const previousUmask = process.umask(0o177);
    try {
      await new Promise<void>((resolve, reject) => {
        this.server?.once('error', reject);
        this.server?.listen(this.path, () => resolve());
      });
    } finally {
      process.umask(previousUmask);
    }
    // Subscribing only after a successful bind means a failed listen() (the
    // "already listening" case, mainly) never leaks this subscription —
    // there is nothing to unwind for a caller who has no reason to call
    // close() on an IpcSocket whose listen() rejected.
    //
    // subscribeInbound, not onMessage: a socket subscriber's ack is
    // explicit and can arrive long after this callback returns (or never,
    // if the subscriber crashes or exits first) — `acknowledge` is held in
    // `pending`/`current` until a real subscriber sends `{"op":"ack",...}`
    // for it, which is what keeps Mailbox's on-disk copy durable in the
    // meantime (D15).
    this.unsubscribeMailbox = this.mailbox.subscribeInbound(
      (envelope, acknowledge) => {
        this.pending.push({ envelope, acknowledge });
        this.pump();
      }
    );
  }

  close(): Promise<void> {
    this.unsubscribeMailbox?.();
    return new Promise((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close(() => {
        try {
          unlinkSync(this.path);
        } catch {
          // Already gone — fine.
        }
        resolve();
      });
    });
  }

  private handleConnection(socket: Socket): void {
    let buffer = '';
    // A local client that resets or drops the connection abruptly must not
    // crash the node with an unhandled 'error' — 'close' still fires right
    // after and does the real cleanup (D3's audit).
    socket.on('error', () => undefined);
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      let newlineAt: number;
      while ((newlineAt = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newlineAt);
        buffer = buffer.slice(newlineAt + 1);
        if (line.trim()) this.handleLine(socket, line);
      }
      if (buffer.length <= MAX_LINE_CHARS) return;
      buffer = '';
      writeLine(socket, { status: 'error', reason: 'request line too long' });
      this.log('dropping a local client that sent an over-long request line');
      socket.destroy();
    });
    socket.on('close', () => this.handleSocketClosed(socket));
  }

  private handleSocketClosed(socket: Socket): void {
    const index = this.subscribers.findIndex((s) => s.socket === socket);
    if (index < 0) return;
    const [gone] = this.subscribers.splice(index, 1);
    if (!gone?.inFlight) return;
    // The consumer dropped mid-message: it stays unacknowledged and goes
    // back to the front of the line for whoever subscribes next.
    this.pending.unshift(gone.inFlight);
    gone.inFlight = null;
    this.pump();
  }

  /** Op name → handler, looked up rather than switched on — a dispatch
   * table keeps this small even as the protocol grows admin ops. */
  private readonly opHandlers: Record<
    string,
    (socket: Socket, record: Record<string, unknown>) => void | Promise<void>
  > = {
    send: (socket, record) => this.handleSend(socket, record),
    subscribe: (socket, record) => this.handleSubscribe(socket, record),
    status: (socket) => this.handleStatus(socket),
    ack: (socket, record) => this.handleAck(socket, record),
    revoke: (socket, record) => handleRevoke(this.peerOps, socket, record),
    rename: (socket, record) => handleRename(this.peerOps, socket, record),
    forget: (socket, record) => handleForget(this.peerOps, socket, record),
    'reload-peers': (socket) => handleReloadPeers(this.peerOps, socket),
  };

  /** The live table and registry the peer-admin ops act on — this node's
   * own instances, the ones Host and Mailbox already share. */
  private get peerOps(): PeerOpContext {
    return { peers: this.peers, connections: this.connections };
  }

  private handleLine(socket: Socket, line: string): void {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (typeof message !== 'object' || message === null) return;
    const record = message as Record<string, unknown>;
    const op = typeof record['op'] === 'string' ? record['op'] : '';
    const handler = this.opHandlers[op];
    if (!handler) return;
    // An op handler may be async (`send` waits on delivery). Its rejection
    // is caught here rather than left floating: `handleLine` itself stays
    // synchronous on purpose, so a long `send` never stalls the ops queued
    // behind it on the same socket.
    try {
      const running = handler(socket, record);
      if (running instanceof Promise)
        running.catch((error: unknown) => this.failOp(socket, op, error));
    } catch (error) {
      this.failOp(socket, op, error);
    }
  }

  /** A failed op still has to put a line on the wire. A caller blocked on a
   * response — `report.sh` waiting on `send` while the disk is full — hangs
   * forever on silence, which for a coding agent means a wedged session. */
  private failOp(socket: Socket, op: string, error: unknown): void {
    const reason = error instanceof Error ? error.message : String(error);
    this.log(`ipc op '${op}' failed: ${reason}`);
    writeLine(socket, { status: 'error', op, reason });
  }

  private handleStatus(socket: Socket): void {
    writeLine(socket, {
      peers: this.mailbox.status(),
      bindAddress: this.bindAddress ?? null,
    });
  }

  private async handleSend(
    socket: Socket,
    record: Record<string, unknown>
  ): Promise<void> {
    const { to, topic, payload, encoding } = record;
    if (
      typeof to !== 'string' ||
      typeof topic !== 'string' ||
      typeof payload !== 'string'
    ) {
      writeLine(socket, {
        status: 'rejected',
        reason: 'malformed send request',
      });
      return;
    }
    const outcome = await this.mailbox.send({
      to,
      topic,
      payload,
      encoding: encoding === 'base64' ? 'base64' : 'utf8',
    });
    writeLine(socket, toWireOutcome(outcome));
  }

  private handleSubscribe(
    socket: Socket,
    record: Record<string, unknown>
  ): void {
    const topic =
      typeof record['topic'] === 'string' ? record['topic'] : undefined;
    const from = isStringArray(record['from']) ? record['from'] : undefined;
    this.subscribers.push({ socket, topic, from, inFlight: null });
    this.pump();
  }

  private handleAck(socket: Socket, record: Record<string, unknown>): void {
    const subscriber = this.subscribers.find((s) => s.socket === socket);
    const inFlight = subscriber?.inFlight;
    if (!subscriber || !inFlight) return;
    // Its own cursor, so an ack can only ever settle the envelope this
    // subscriber was actually handed — a stale or invented id is ignored
    // rather than crediting somebody else's message.
    if (record['id'] !== inFlight.envelope.id) return;
    inFlight.acknowledge();
    subscriber.inFlight = null;
    this.pump();
  }

  private subscriberWants(subscriber: Subscriber, envelope: Envelope): boolean {
    if (subscriber.topic && subscriber.topic !== envelope.topic) return false;
    if (subscriber.from && !subscriber.from.includes(envelope.from)) {
      return false;
    }
    return true;
  }

  /** Give every idle subscriber the oldest pending envelope it will take.
   *
   * Sequential per subscriber, concurrent across them: a subscriber holds
   * one envelope until it acks it or its consumer disconnects, and that
   * holds up nothing but its own stream. A subscriber that stays connected
   * and never acks is the ordinary shape of a wedged consumer, and it must
   * not be able to stop the rest of the node's mail — least of all mail on
   * topics it does not even subscribe to.
   *
   * An envelope no *idle* subscriber wants stays in `pending`, in order,
   * for whichever subscriber does want it — skipped, never acked and
   * discarded, and never blocking the ones behind it. */
  private pump(): void {
    for (const subscriber of this.subscribers) {
      if (subscriber.inFlight) continue;
      const index = this.pending.findIndex(({ envelope }) =>
        this.subscriberWants(subscriber, envelope)
      );
      if (index < 0) continue;
      const [taken] = this.pending.splice(index, 1);
      if (!taken) continue;
      subscriber.inFlight = taken;
      writeLine(subscriber.socket, taken.envelope);
    }
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}
