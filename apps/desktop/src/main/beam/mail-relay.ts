/**
 * The desktop's mailbox relay (decisions.md D13/D14): a `msg.subscribe`
 * on its own control connection, each envelope resolved against this
 * machine's sessions and delivered (typed into an agent's pane, or
 * posted to a Claude session's inbox), then settled at once — `msg.ack`
 * after a delivery or a dismissal, `msg.defer` with the reason otherwise.
 * A fresh subscription is offered the deferred again.
 */
import {
  deliverToRunningSession,
  parseRelayPayload,
  postToClaudeSession,
  type ClaudePost,
  resolveLocalRelayTarget,
  type LocalDeliveryTarget,
} from '@n10/core';
import type { InboundMailItem } from '../../host/contract-machines.js';
import type { InboundMailPort } from '../../host/services/inbound-mail.js';
import { ControlConnection } from './control.js';
import {
  MAX_RELAY_MESSAGE_BYTES,
  payloadText,
  sanitizeRelayMessage,
  senderGrant,
  truncateReason,
  type Envelope,
} from './mail-envelope.js';

export interface MailRelayOptions {
  socketPath: string;
  /** Overridable for tests; defaults to the real registry lookup. */
  resolveTarget?: (target: string) => LocalDeliveryTarget;
  /** Overridable for tests; defaults to the real injection primitive. */
  deliver?: (key: string, message: string) => boolean;
  /** Overridable for tests; defaults to core's Claude inbox post. A
   *  registered session not live is waited for, like a pane not
   *  connected yet; an id nothing registers is refused. */
  postToClaude?: (sessionId: string, text: string) => Promise<ClaudePost>;
  retryMs?: number;
  now?: () => number;
  log?: (message: string) => void;
  /** Called after any change to what's waiting or refused. */
  onChange?: () => void;
}

/** Orchestra's reports travel on this topic (report.sh, relay.sh). */
const TOPIC = 'orchestra';
const DEFAULT_RETRY_MS = 10_000;
type Verdict =
  | { kind: 'delivered' }
  | { kind: 'waiting'; target: string }
  | { kind: 'refused'; target: string; reason: string };

interface HeldItem extends InboundMailItem {
  peerId: string;
}

export class MailRelay implements InboundMailPort {
  private readonly resolveTarget: (target: string) => LocalDeliveryTarget;
  private readonly deliver: (key: string, message: string) => boolean;
  private readonly postToClaude: (
    sessionId: string,
    text: string
  ) => Promise<ClaudePost>;
  private readonly now: () => number;
  private readonly onChange: () => void;
  private readonly retryMs: number;
  private readonly waiting = new Map<string, HeldItem>();
  private readonly refused = new Map<string, HeldItem>();
  /** Ids typed into a pane this run. An ack lost with its connection
   *  leaves the envelope with beam, which offers it again; this is what
   *  stops that redelivery from pasting the same report twice. */
  private readonly delivered = new Set<string>();
  /** Ids a person dismissed: acked, undelivered, when next offered. */
  private readonly dismissed = new Set<string>();
  private conn: ControlConnection | null = null;
  /** Bumped by every start and stop: a start overtaken by either
   *  abandons its connection instead of subscribing on it. */
  private generation = 0;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly options: MailRelayOptions) {
    this.resolveTarget = options.resolveTarget ?? resolveLocalRelayTarget;
    this.deliver = options.deliver ?? deliverToRunningSession;
    this.postToClaude = options.postToClaude ?? postToClaudeSession;
    this.now = options.now ?? Date.now;
    this.onChange = options.onChange ?? (() => undefined);
    this.retryMs = options.retryMs ?? DEFAULT_RETRY_MS;
  }

  /** Subscribes on a fresh connection. Resolves once subscribed;
   *  `onClosed` fires if that connection later ends. */
  async start(onClosed: () => void): Promise<void> {
    const generation = ++this.generation;
    const conn = await ControlConnection.connect(this.options.socketPath);
    if (generation !== this.generation) {
      conn.close();
      return;
    }
    this.conn = conn;
    conn.onEvent((event, data) => {
      if (event === 'mail') this.enqueue(conn, data as Envelope);
    });
    conn.onClose(() => {
      if (this.conn !== conn) return;
      this.stop();
      onClosed();
    });
    try {
      await conn.request('msg.subscribe', { topic: TOPIC });
    } catch (err) {
      if (this.conn === conn) this.stop();
      throw err;
    }
  }

  stop(): void {
    this.generation++;
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    const conn = this.conn;
    this.conn = null;
    conn?.close();
  }

  snapshotFor(peerId: string): {
    inboundWaiting: InboundMailItem[];
    inboundRefused: InboundMailItem[];
  } {
    const byPeer = (items: Iterable<HeldItem>): InboundMailItem[] =>
      [...items]
        .filter((i) => i.peerId === peerId)
        .sort((a, b) => a.receivedAt - b.receivedAt)
        .map(({ id, target, reason, receivedAt }) =>
          reason === undefined
            ? { id, target, receivedAt }
            : { id, target, reason, receivedAt }
        );
    return {
      inboundWaiting: byPeer(this.waiting.values()),
      inboundRefused: byPeer(this.refused.values()),
    };
  }

  /** Discards a refused report without delivering it: beam offers it to
   *  a fresh subscription, which acks it. */
  dismiss(id: string): void {
    if (!this.refused.delete(id)) return;
    this.dismissed.add(id);
    this.notify();
    this.resubscribe();
  }

  private enqueue(conn: ControlConnection, envelope: Envelope): void {
    this.queue = this.queue
      .then(() => this.settle(conn, envelope))
      .catch((err: unknown) =>
        this.options.log?.(`[beam] mail ${envelope.id}: ${String(err)}`)
      );
  }

  /** Settles on the connection the envelope came on: beam holds an
   *  envelope in flight per subscriber, and one whose subscriber ended
   *  is offered again. */
  private async settle(
    conn: ControlConnection,
    envelope: Envelope
  ): Promise<void> {
    if (conn !== this.conn) return;
    const verdict = await this.verdictFor(conn, envelope);
    if (conn !== this.conn) return; // stopped or resubscribed meanwhile
    this.record(envelope, verdict);
    await this.answer(conn, envelope, verdict);
  }

  private async answer(
    conn: ControlConnection,
    envelope: Envelope,
    verdict: Verdict
  ): Promise<void> {
    try {
      if (verdict.kind === 'delivered') {
        await conn.request('msg.ack', { envelopeId: envelope.id });
        this.dismissed.delete(envelope.id);
      } else {
        const reason =
          verdict.kind === 'waiting'
            ? `waiting for ${verdict.target} to connect`
            : verdict.reason;
        await conn.request('msg.defer', {
          envelopeId: envelope.id,
          reason: truncateReason(reason),
        });
      }
    } catch {
      // The connection went, or the subscription was replaced under this
      // envelope: beam still holds it and offers it again.
    }
  }

  /** A refusal stands until a person dismisses it: answered again from
   *  what was recorded, never resolved again (D14: a freed session name
   *  goes to the next session opened). */
  private async verdictFor(
    conn: ControlConnection,
    envelope: Envelope
  ): Promise<Verdict> {
    const { id } = envelope;
    if (this.delivered.has(id) || this.dismissed.has(id)) {
      return { kind: 'delivered' };
    }
    const refused = this.refused.get(id);
    if (refused) {
      return {
        kind: 'refused',
        target: refused.target,
        reason: refused.reason ?? '',
      };
    }
    try {
      return await this.handle(conn, envelope);
    } catch (err) {
      return {
        kind: 'refused',
        target: '(unknown)',
        reason: `delivery failed here: ${String(err)}`,
      };
    }
  }

  private async handle(
    conn: ControlConnection,
    envelope: Envelope
  ): Promise<Verdict> {
    const parsed = parseRelayPayload(payloadText(envelope), 'utf8');
    if (!parsed) {
      return {
        kind: 'refused',
        target: '(no target)',
        reason: 'the message carries no "target: " header',
      };
    }
    // Refused, not truncated: a message this size is not something this
    // machine can decide the safe half of.
    if (Buffer.byteLength(parsed.message, 'utf8') > MAX_RELAY_MESSAGE_BYTES) {
      return {
        kind: 'refused',
        target: parsed.target,
        reason: `the message is larger than the ${MAX_RELAY_MESSAGE_BYTES} bytes this machine accepts`,
      };
    }
    // Typing into a session is `all`'s privilege; `msg` is the mailbox
    // alone (D14).
    const grant = await senderGrant(conn, envelope.from);
    if (grant === undefined) return { kind: 'waiting', target: parsed.target };
    if (grant !== 'all') {
      return {
        kind: 'refused',
        target: parsed.target,
        reason: grant
          ? `this machine grants the sender "${grant}", which does not deliver into a session; "all" does`
          : 'the sender is not a member of this fleet here',
      };
    }
    // Resolved afresh on every offer of a waiting envelope (D14).
    const resolved = this.resolveTarget(parsed.target);
    if (resolved.kind === 'refused') {
      return {
        kind: 'refused',
        target: parsed.target,
        reason: resolved.reason,
      };
    }
    const message = sanitizeRelayMessage(parsed.message);
    const outcome =
      resolved.kind === 'claude'
        ? await this.postToClaude(resolved.sessionId, message)
        : this.deliver(resolved.key, message)
        ? 'delivered'
        : 'not-live';
    return this.verdictOf(envelope.id, parsed.target, outcome);
  }

  private verdictOf(id: string, target: string, outcome: ClaudePost): Verdict {
    if (outcome === 'delivered') {
      this.delivered.add(id);
      return { kind: 'delivered' };
    }
    return outcome === 'not-live'
      ? { kind: 'waiting', target }
      : {
          kind: 'refused',
          target,
          reason: 'no Claude session by that id is registered here',
        };
  }

  private record(envelope: Envelope, verdict: Verdict): void {
    const known =
      this.waiting.get(envelope.id) ?? this.refused.get(envelope.id);
    this.waiting.delete(envelope.id);
    this.refused.delete(envelope.id);
    const receivedAt = known?.receivedAt ?? this.now();
    const base = { id: envelope.id, peerId: envelope.from, receivedAt };
    if (verdict.kind === 'waiting') {
      this.waiting.set(envelope.id, { ...base, target: verdict.target });
      this.scheduleRetry();
    } else if (verdict.kind === 'refused') {
      this.refused.set(envelope.id, {
        ...base,
        target: verdict.target,
        reason: verdict.reason,
      });
    }
    this.notify();
  }

  /** A throw from the listener is reported, never raised into the
   *  envelope's settling, which must still answer beam. */
  private notify(): void {
    try {
      this.onChange();
    } catch (err) {
      this.options.log?.(`[beam] mail change: ${String(err)}`);
    }
  }

  private scheduleRetry(): void {
    if (this.retry) return;
    this.retry = setTimeout(() => {
      this.retry = null;
      this.resubscribe();
    }, this.retryMs);
    this.retry.unref?.();
  }

  /** A second subscribe on the connection replaces the first and is
   *  offered everything deferred before it (beam docs/05). Queued
   *  behind the envelope being settled, so its answer is not lost. */
  private resubscribe(): void {
    this.queue = this.queue.then(async () => {
      try {
        await this.conn?.request('msg.subscribe', { topic: TOPIC });
      } catch {
        // The connection is gone; the client resubscribes on reconnect.
      }
    });
  }
}
