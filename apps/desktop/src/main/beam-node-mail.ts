/**
 * Worker-side half of the desktop's mailbox relay (docs/beam.md's
 * "Durable mailbox" section, decisions.md D13/D14): subscribes to the
 * beam node's `Mailbox` and forwards every accepted envelope across the
 * utility-process boundary as an event, holding that envelope's
 * `acknowledge()` open until `ack()` is called explicitly.
 *
 * Deliberately built on `subscribeInbound`, not `onMessage`: the
 * subscriber ack (docs/beam.md's two-acknowledgement table) must mean
 * "main delivered this into a pane", and that answer can arrive long
 * after this handler returns — `onMessage`'s auto-ack-on-return would
 * ack before main has even resolved a target, let alone delivered.
 * Delivery itself needs the PTY registry, which lives in the main
 * process (apps/desktop/AGENTS.md: "the main process only attaches
 * local clients"), so this module only forwards and holds the ack —
 * `beam-mail-relay.ts` in main does the resolving and delivering.
 *
 * Typed against the minimal slices of `Mailbox`/`PeerTable` it needs
 * (structural, not the full classes) so it is testable with plain fake
 * objects, the same way `beam-node-remote-ops.ts` types against
 * `ConnectionRegistry`/`PeerTable` interfaces rather than requiring a
 * real node.
 */

export interface InboundMailEvent {
  id: string;
  /** Sender peerId — identity, never display text. */
  from: string;
  /** The sender's label as this machine's peer table knows it, for
   *  every user-facing string (ux-machines.md §7: "machine", never a
   *  raw peerId). Falls back to the peerId itself when unknown — this
   *  machine still has the envelope and must say something honest. */
  fromLabel: string;
  topic: string;
  payload: string;
  encoding: 'utf8' | 'base64';
  createdAt: number;
}

interface MinimalEnvelope {
  id: string;
  from: string;
  topic: string;
  payload: string;
  encoding: 'utf8' | 'base64';
  createdAt: number;
}

interface MinimalMailbox {
  subscribeInbound(
    handler: (envelope: MinimalEnvelope, acknowledge: () => void) => void
  ): () => void;
}

interface MinimalPeerTable {
  list(): { peerId: string; label: string }[];
}

interface PendingMail {
  acknowledge: () => void;
  event: InboundMailEvent;
}

export class InboundMailSubscriber {
  private readonly pending = new Map<string, PendingMail>();
  private readonly listeners = new Set<(event: InboundMailEvent) => void>();
  private readonly unsubscribe: () => void;

  constructor(
    mailbox: MinimalMailbox,
    private readonly peers: MinimalPeerTable
  ) {
    this.unsubscribe = mailbox.subscribeInbound((envelope, acknowledge) =>
      this.handle(envelope, acknowledge)
    );
  }

  private labelFor(peerId: string): string {
    return this.peers.list().find((p) => p.peerId === peerId)?.label ?? peerId;
  }

  private handle(envelope: MinimalEnvelope, acknowledge: () => void): void {
    const event: InboundMailEvent = {
      id: envelope.id,
      from: envelope.from,
      fromLabel: this.labelFor(envelope.from),
      topic: envelope.topic,
      payload: envelope.payload,
      encoding: envelope.encoding,
      createdAt: envelope.createdAt,
    };
    this.pending.set(envelope.id, { acknowledge, event });
    for (const cb of this.listeners) cb(event);
  }

  /** Pushed once per envelope this subscriber currently holds unacked,
   *  plus every live arrival after. The mailbox replays its backlog
   *  synchronously inside `subscribeInbound`, called from this class's
   *  own constructor — which always returns before a caller can attach
   *  a listener — so a listener attaching after construction replays
   *  whatever is still pending immediately, rather than only seeing
   *  envelopes that arrive after it happened to attach. That is what
   *  makes drain-on-start (docs/beam.md) work: `beam-node-worker.ts`
   *  calls `onMail` after `new BeamNode()` has already subscribed.
   *  Returns an unsubscribe function. */
  onMail(cb: (event: InboundMailEvent) => void): () => void {
    for (const { event } of this.pending.values()) cb(event);
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** The subscriber ack (docs/beam.md): main calls this only once it
   *  has actually delivered the envelope. `false` for an id already
   *  acked or never seen — a caller must not treat that as success. */
  ack(id: string): boolean {
    const item = this.pending.get(id);
    if (!item) return false;
    this.pending.delete(id);
    item.acknowledge();
    return true;
  }

  dispose(): void {
    this.unsubscribe();
    this.listeners.clear();
    this.pending.clear();
  }
}
