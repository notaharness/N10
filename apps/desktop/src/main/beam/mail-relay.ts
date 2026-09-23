/**
 * The desktop's mailbox relay (decisions.md D13/D14): a `msg.subscribe`
 * on its own control connection, each envelope resolved against this
 * machine's session registry and typed into that pane, then settled at
 * once — `msg.ack` after a delivery or a dismissal, `msg.defer` with the
 * reason otherwise. A fresh subscription is offered the deferred again.
 */
import {
  deliverToRunningSession,
  parseRelayPayload,
  resolveLocalRelayTarget,
  type LocalDeliveryTarget,
} from '@n10/core';
import type { InboundMailItem } from '../../host/contract-machines.js';
import type { InboundMailPort } from '../../host/services/inbound-mail.js';
import { ControlConnection } from './control.js';

/** beam docs/05's envelope, as a `mail` event carries it. */
export interface Envelope {
  id: string;
  from: string;
  payload: string;
  encoding: 'utf8' | 'base64';
}

export interface MailRelayOptions {
  socketPath: string;
  /** Overridable for tests; defaults to the real registry lookup. */
  resolveTarget?: (target: string) => LocalDeliveryTarget;
  /** Overridable for tests; defaults to the real injection primitive. */
  deliver?: (key: string, message: string) => boolean;
  retryMs?: number;
  now?: () => number;
  log?: (message: string) => void;
  /** Called after any change to what's waiting or refused. */
  onChange?: () => void;
}

/** Orchestra's reports travel on this topic (report.sh, relay.sh). */
const TOPIC = 'orchestra';
const DEFAULT_RETRY_MS = 10_000;
/** beam docs/06: a defer's reason is at most 1 KiB. */
const MAX_REASON_BYTES = 1000;

/** Generous enough for the agent reports the relay exists to carry,
 *  small enough that a single envelope cannot paste a novel into a REPL. */
const MAX_RELAY_MESSAGE_BYTES = 32 * 1024;

/** Strips what a terminal would act on rather than display: the C0
 *  controls other than tab and newline (ESC and everything it can
 *  drive, BEL, backspace), DEL and the C1 range. A carriage return
 *  becomes a newline — `deliverToRunningSession` submits with a
 *  trailing CR of its own, so an embedded one is a submit in the
 *  middle of somebody else's message. */
function sanitizeRelayMessage(message: string): string {
  return (
    message
      .replace(/\r\n?/g, '\n')
      // eslint-disable-next-line no-control-regex -- matching control characters is the point
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, '')
  );
}

/** base64 payloads are unpadded base64url (beam docs/05). */
function payloadText(envelope: Envelope): string {
  return envelope.encoding === 'base64'
    ? Buffer.from(envelope.payload, 'base64url').toString('utf8')
    : envelope.payload;
}

function truncateReason(reason: string): string {
  const bytes = Buffer.from(reason, 'utf8');
  return bytes.length <= MAX_REASON_BYTES
    ? reason
    : bytes.subarray(0, MAX_REASON_BYTES).toString('utf8');
}

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
    this.onChange();
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
    const verdict = this.verdictFor(envelope);
    await this.answer(conn, envelope, verdict);
    this.record(envelope, verdict);
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
  private verdictFor(envelope: Envelope): Verdict {
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
      return this.handle(envelope);
    } catch (err) {
      return {
        kind: 'refused',
        target: '(unknown)',
        reason: `delivery failed here: ${String(err)}`,
      };
    }
  }

  private handle(envelope: Envelope): Verdict {
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
    // Resolved afresh on every offer of a waiting envelope (D14).
    const resolved = this.resolveTarget(parsed.target);
    if (resolved.kind === 'refused') {
      return {
        kind: 'refused',
        target: parsed.target,
        reason: resolved.reason,
      };
    }
    if (this.deliver(resolved.key, sanitizeRelayMessage(parsed.message))) {
      this.delivered.add(envelope.id);
      return { kind: 'delivered' };
    }
    return { kind: 'waiting', target: parsed.target };
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
    this.onChange();
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
