/**
 * The durable mailbox: one queue per peer, drained over whichever
 * connection to that peer is live, with strictly sequential delivery and
 * receiver-side dedup. See docs/beam.md's "Durable mailbox" section, which
 * this implements, and beam.md D7/D9 — beam's own register, not the
 * machine-integration one in docs/decisions.md, whose D9 is a different
 * decision about a different subject.
 */

import { randomUUID } from 'node:crypto';
import type { ConnectionRegistry } from '../connection-registry.js';
import type { Identity } from '../identity.js';
import { isTopic } from '../identifiers.js';
import type { PeerRecord, PeerTable } from '../peer-table.js';
import type { StreamRegistry } from '../stream-registry.js';
import {
  envelopeFitsOneFrame,
  MAX_PAYLOAD_BYTES,
  payloadByteLength,
  type Envelope,
} from './envelope.js';
import { Flusher } from './flusher.js';
import { InboundReceiver, type InboundHandler } from './inbound-receiver.js';
import { OutboundQueue, type QuarantinedFile } from './outbound-queue.js';
import type { QueueLimits } from './queue-limits.js';
import { derivePeerState, type PeerState } from './peer-state.js';
import type { MailboxCorruptionError } from './seen-tracker.js';
import { SeqCounter } from './seq-counter.js';

export type { InboundHandler };

export type RejectReason =
  | 'unknown-peer'
  | 'revoked-peer'
  | 'oversized-payload'
  /** This peer's queue is at its depth or byte bound. Nothing was stored,
   * so the caller was promised nothing and may retry once the queue
   * drains. */
  | 'queue-full'
  /** The topic is over-long, or carries a path separator, a brace or a
   * control character. Topics reach logs and the JSON lines other tools
   * parse, so they are refused rather than rewritten. The empty topic is
   * valid and means "no topic". */
  | 'invalid-topic'
  /** The envelope could not be written down: a full or read-only disk, a
   * permission problem, a seq collision. Nothing was stored, so — unlike
   * `queued` — the caller has not been promised delivery and may retry. */
  | 'storage-failure';

export type SendOutcome =
  | { outcome: 'delivered'; to: string; label: string; queueDepth: number }
  | {
      outcome: 'queued';
      to: string;
      label: string;
      queueDepth: number;
      reason: string;
    }
  // `to` echoes what the caller asked for (a label or a peerId — whatever
  // was passed to send()); `label` is the resolved display name where one
  // could be resolved at all, absent for `unknown-peer` since there is
  // nothing to resolve it from. D11/D9: a rejection must still say who it
  // was for, not only why.
  | { outcome: 'rejected'; to: string; label?: string; reason: RejectReason };

export interface SendInput {
  /** A peerId or label — the same lookup dial()/PeerTable.resolve use. */
  to: string;
  topic: string;
  payload: string;
  encoding?: 'utf8' | 'base64';
}

export interface PeerStatus {
  peerId: string;
  label: string;
  revoked: boolean;
  state: PeerState;
  queueDepth: number;
}

export interface QueuedForPeer {
  peerId: string;
  envelope: Envelope;
}

export interface MailboxOptions {
  identity: Identity;
  peers: PeerTable;
  connections: ConnectionRegistry;
  registry: StreamRegistry;
  beamDir: string;
  now?: () => number;
  /** How long `send()` waits for delivery before reporting `queued`
   * instead — the underlying flusher keeps retrying regardless. */
  sendAwaitMs?: number;
  ackTimeoutMs?: number;
  retryIntervalMs?: number;
  log?: (message: string) => void;
  onQuarantine?: (info: QuarantinedFile) => void;
  onCorruption?: (error: MailboxCorruptionError) => void;
  /** Per-peer bounds on both durable queues; defaults in
   * mailbox/queue-limits.ts. */
  queueLimits?: Partial<QueueLimits>;
}

const DEFAULT_SEND_AWAIT_MS = 5_000;

export class Mailbox {
  private readonly identity: Identity;
  private readonly peers: PeerTable;
  private readonly connections: ConnectionRegistry;
  private readonly queueStore: OutboundQueue;
  private readonly inbound: InboundReceiver;
  private readonly seqCounter: SeqCounter;
  private readonly flusher: Flusher;
  private readonly now: () => number;
  private readonly sendAwaitMs: number;
  private readonly log: (message: string) => void;
  private readonly deliveryWaiters = new Map<
    string,
    (delivered: boolean) => void
  >();

  constructor(options: MailboxOptions) {
    this.identity = options.identity;
    this.peers = options.peers;
    this.connections = options.connections;
    this.now = options.now ?? Date.now;
    this.sendAwaitMs = options.sendAwaitMs ?? DEFAULT_SEND_AWAIT_MS;
    this.log = options.log ?? (() => undefined);

    this.queueStore = new OutboundQueue(options.beamDir, {
      onQuarantine: (info) => this.reportQuarantine(info, options.onQuarantine),
      limits: options.queueLimits,
    });
    this.inbound = new InboundReceiver({
      beamDir: options.beamDir,
      onCorruption: options.onCorruption,
      limits: options.queueLimits,
    });
    this.seqCounter = new SeqCounter(options.beamDir);
    this.flusher = new Flusher({
      queue: this.queueStore,
      connections: this.connections,
      ackTimeoutMs: options.ackTimeoutMs,
      retryIntervalMs: options.retryIntervalMs,
      log: this.log,
      onDelivered: (peerId, envelope) =>
        this.resolveDelivery(envelope.id, true),
      isRevoked: (peerId) => this.peers.get(peerId)?.revoked === true,
    });

    options.registry.register('msg', (stream) =>
      this.inbound.handleStream(stream)
    );
    this.connections.onConnect((connection) =>
      this.flusher.kick(connection.peerId)
    );
    // Flush trigger: node start. Anything already queued for a peer that
    // happens to have a live connection right now is drained immediately;
    // everything else waits for that peer's onConnect.
    for (const peerId of this.queueStore.peerIds()) this.flusher.kick(peerId);
  }

  /**
   * Send one envelope to `to` (a peerId or label). Resolves to `delivered`,
   * `queued` (a success — the message is durable, the caller must not
   * resend it) or `rejected` (nothing was stored).
   */
  async send(input: SendInput): Promise<SendOutcome> {
    const peer = this.peers.resolve(input.to);
    if (!peer) {
      return { outcome: 'rejected', reason: 'unknown-peer', to: input.to };
    }
    if (peer.revoked) {
      return {
        outcome: 'rejected',
        reason: 'revoked-peer',
        to: peer.peerId,
        label: peer.label,
      };
    }

    if (!isTopic(input.topic)) {
      return {
        outcome: 'rejected',
        reason: 'invalid-topic',
        to: peer.peerId,
        label: peer.label,
      };
    }

    const encoding = input.encoding ?? 'utf8';
    if (
      payloadByteLength({ payload: input.payload, encoding }) >
      MAX_PAYLOAD_BYTES
    ) {
      return {
        outcome: 'rejected',
        reason: 'oversized-payload',
        to: peer.peerId,
        label: peer.label,
      };
    }

    const stored = this.storeOutbound(peer, input, encoding);
    if ('reason' in stored) {
      return {
        outcome: 'rejected',
        reason: stored.reason,
        to: peer.peerId,
        label: peer.label,
      };
    }
    const envelope = stored.envelope;

    const delivered = await this.awaitDelivery(envelope.id, peer.peerId);
    const queueDepth = this.queueStore.depth(peer.peerId);
    if (delivered) {
      return {
        outcome: 'delivered',
        to: peer.peerId,
        label: peer.label,
        queueDepth,
      };
    }
    const reason = this.connections.get(peer.peerId)
      ? 'no ack before the timeout — beam will keep trying while connected'
      : 'peer not connected — beam will deliver this the next time it comes online';
    return {
      outcome: 'queued',
      to: peer.peerId,
      label: peer.label,
      queueDepth,
      reason,
    };
  }

  /**
   * Reserve a seq, write the envelope down, and only then record the seq as
   * spent — the claim is made once the message is known-storable, because a
   * number claimed for a message that never reached disk is a permanent gap
   * in that peer's sequence. Null means nothing was stored.
   *
   * A storage failure is an outcome, never a rejected promise: `send()` is
   * what `report.sh` reaches through the IPC socket, and a caller left
   * holding a rejection it cannot see waits for a response line that never
   * comes.
   *
   * Reserve, write and commit are all synchronous with no `await` between
   * them, so two concurrent senders cannot be handed the same seq.
   */
  private storeOutbound(
    peer: PeerRecord,
    input: SendInput,
    encoding: 'utf8' | 'base64'
  ): { envelope: Envelope } | { reason: RejectReason } {
    if (this.queueStore.isFull(peer.peerId)) return { reason: 'queue-full' };
    try {
      const seq = this.seqCounter.reserve(peer.peerId);
      const envelope: Envelope = {
        id: randomUUID(),
        from: this.identity.peerId,
        to: peer.peerId,
        seq,
        topic: input.topic,
        payload: input.payload,
        encoding,
        createdAt: this.now(),
      };
      // The decoded payload cap above is not the whole story: the wire
      // form is `JSON.stringify(envelope)`, and JSON escaping is not size
      // preserving. Anything that will not encode has to be refused here,
      // because once it is queued the caller has been told it is durable
      // and the flusher has a head-of-queue message it can never send.
      if (!envelopeFitsOneFrame(envelope)) {
        return { reason: 'oversized-payload' };
      }
      this.queueStore.enqueue(peer.peerId, envelope);
      this.seqCounter.commit(peer.peerId, seq);
      return { envelope };
    } catch (error) {
      this.log(
        `could not queue a message for ${peer.peerId}: ${
          (error as Error).message
        }`
      );
      return { reason: 'storage-failure' };
    }
  }

  /** Envelopes accepted from a peer, delivered exactly once each, in
   * sender order. Returns an unsubscribe function.
   *
   * The handler's return *is* the acknowledgement (docs/beam.md's "In the
   * library, a handler returning successfully is that acknowledgement"):
   * once it returns without throwing, this receiver's on-disk copy
   * (`mailbox/in/`) is unlinked. A handler that throws leaves the envelope
   * in place, to be redelivered — this is the simple, auto-ack API; a
   * caller that needs to hold the receiver's copy open past this call
   * returning (IpcSocket's explicit subscriber ack) uses
   * `subscribeInbound` instead. */
  onMessage(handler: (envelope: Envelope) => void): () => void {
    return this.subscribeInbound((envelope, acknowledge) => {
      try {
        handler(envelope);
        acknowledge();
      } catch (error) {
        const msg = (error as Error).message;
        this.log(
          `inbound handler for ${envelope.from}/${envelope.id} threw, leaving it for redelivery: ${msg}`
        );
      }
    });
  }

  /** Lower-level subscription: see InboundReceiver.subscribe. Returns an
   * unsubscribe function. */
  subscribeInbound(handler: InboundHandler): () => void {
    return this.inbound.subscribe(handler);
  }

  status(): PeerStatus[] {
    return this.peers.list().map((peer) => ({
      peerId: peer.peerId,
      label: peer.label,
      revoked: peer.revoked,
      state: derivePeerState(
        peer,
        this.connections.get(peer.peerId) !== undefined
      ),
      queueDepth: this.queueStore.depth(peer.peerId),
    }));
  }

  /** What is waiting, oldest first; every peer's queue, or one peer's. */
  queue(peerId?: string): QueuedForPeer[] {
    const ids = peerId ? [peerId] : this.queueStore.peerIds();
    const out: QueuedForPeer[] = [];
    for (const id of ids) {
      for (const { envelope } of this.queueStore.list(id))
        out.push({ peerId: id, envelope });
    }
    return out;
  }

  /** Messages lost to quarantine — a queue file too corrupt to ever recover
   * or send, meaning a message a caller was already told was durable
   * (`queued`) is gone. Quarantine must be loud, never silent (D1): this is
   * what lets `beam msg queue` show it, and it stays discoverable here
   * across a restart, since the file and its reason stay on disk in
   * `corrupt/` — unlike the transient `onQuarantine` callback, which only
   * fires for the process that was running at the moment of quarantine. */
  quarantined(peerId?: string): QuarantinedFile[] {
    const ids = peerId ? [peerId] : this.queueStore.peerIds();
    return ids.flatMap((id) => this.queueStore.quarantined(id));
  }

  dispose(): void {
    this.flusher.dispose();
    for (const resolve of this.deliveryWaiters.values()) resolve(false);
    this.deliveryWaiters.clear();
  }

  private awaitDelivery(envelopeId: string, peerId: string): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.deliveryWaiters.delete(envelopeId);
        resolve(false);
      }, this.sendAwaitMs);
      timer.unref?.();
      this.deliveryWaiters.set(envelopeId, (delivered) => {
        clearTimeout(timer);
        resolve(delivered);
      });
      this.flusher.kick(peerId);
    });
  }

  private resolveDelivery(envelopeId: string, delivered: boolean): void {
    const resolve = this.deliveryWaiters.get(envelopeId);
    if (!resolve) return;
    this.deliveryWaiters.delete(envelopeId);
    resolve(delivered);
  }

  /** A quarantined file means a message a caller was already told was
   * durable (`queued`) is gone and can never be sent — surfaced loudly
   * (D1), never left for the caller to discover only by its absence: logged
   * on the node's own diagnostic path (`this.log`, which defaults to
   * `console.log` — see Host's default), handed to whoever passed
   * `onQuarantine`, and durably discoverable afterwards via `quarantined()`
   * even across a restart, since the file and its reason stay on disk. */
  private reportQuarantine(
    info: QuarantinedFile,
    forward?: (info: QuarantinedFile) => void
  ): void {
    this.log(
      `quarantined ${info.peerId}/${info.fileName} — message lost, it will never be delivered: ${info.reason}`
    );
    forward?.(info);
  }
}
