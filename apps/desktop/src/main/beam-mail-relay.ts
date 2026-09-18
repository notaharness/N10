/**
 * Main-process half of the desktop's mailbox relay (decisions.md
 * D13/D14, docs/beam.md's "Durable mailbox"): for every envelope
 * `beam-node-mail.ts` forwards from the worker, resolve its "target:
 * <local>" header against this machine's own session registry
 * (`resolveLocalRelayTarget`, never the envelope's say-so) and deliver
 * into the pane (`deliverToRunningSession`) — both live in `@n10/core`,
 * which is why this runs in main rather than the worker: the PTY
 * registry only exists here (apps/desktop/AGENTS.md: "the main process
 * only attaches local clients").
 *
 * Only a successful delivery acks (`port.ackInboundMail`); a refusal
 * never does, and a delivery that merely finds no live connection is
 * neither — it waits, retried on a timer, until the target session
 * connects. Retrying every envelope on one fixed interval (rather than
 * a bounded per-envelope backoff) is the policy: it cannot block an
 * envelope behind a stuck one (each id is retried independently on the
 * same sweep), and a fixed interval cannot become a tight loop the way
 * an unbounded immediate retry could. A refusal is not retried — the
 * target will not become deliverable by waiting — but it is not
 * silently dropped either: it stays visible until a person dismisses
 * it, which is the one thing that acks a refusal.
 */
import {
  deliverToRunningSession,
  parseRelayPayload,
  resolveLocalRelayTarget,
  type LocalDeliveryTarget,
} from '@n10/core';
import type { InboundMailEvent } from './beam-node-mail.js';

export interface InboundMailItem {
  id: string;
  target: string;
  /** Present only for a refused item. */
  reason?: string;
  receivedAt: number;
}

export interface RelayPort {
  onInboundMail(cb: (event: InboundMailEvent) => void): () => void;
  ackInboundMail(id: string): Promise<void>;
}

export interface MailRelayOptions {
  port: RelayPort;
  /** Overridable for tests; defaults to the real registry lookup. */
  resolveTarget?: (target: string) => LocalDeliveryTarget;
  /** Overridable for tests; defaults to the real injection primitive. */
  deliver?: (key: string, message: string) => boolean;
  retryIntervalMs?: number;
  now?: () => number;
  /** Called after any change to what's waiting or refused, for a
   *  listener to re-push the machines list with a fresh overlay. */
  onChange?: () => void;
}

const DEFAULT_RETRY_INTERVAL_MS = 3_000;

interface WaitingItem extends InboundMailItem {
  peerId: string;
  key: string;
  message: string;
}

interface RefusedItem extends InboundMailItem {
  peerId: string;
  reason: string;
}

export class MailRelay {
  private readonly port: RelayPort;
  private readonly resolveTarget: (target: string) => LocalDeliveryTarget;
  private readonly deliver: (key: string, message: string) => boolean;
  private readonly now: () => number;
  private readonly onChange: () => void;
  private readonly waiting = new Map<string, WaitingItem>();
  private readonly refused = new Map<string, RefusedItem>();
  /** Envelope ids already delivered-and-acked, so a mailbox-level
   *  redelivery (a restart replaying the backlog before our ack has
   *  landed, or any other at-least-once duplicate) can never reach
   *  `deliver()` twice for the same report. */
  private readonly delivered = new Set<string>();
  private readonly timer: ReturnType<typeof setInterval>;

  constructor(options: MailRelayOptions) {
    this.port = options.port;
    this.resolveTarget = options.resolveTarget ?? resolveLocalRelayTarget;
    this.deliver = options.deliver ?? deliverToRunningSession;
    this.now = options.now ?? Date.now;
    this.onChange = options.onChange ?? (() => undefined);
    this.port.onInboundMail((event) => this.handle(event));
    this.timer = setInterval(
      () => this.retryWaiting(),
      options.retryIntervalMs ?? DEFAULT_RETRY_INTERVAL_MS
    );
    this.timer.unref?.();
  }

  private handle(event: InboundMailEvent): void {
    if (this.delivered.has(event.id) || this.waiting.has(event.id)) return;
    const parsed = parseRelayPayload(event.payload, event.encoding);
    if (!parsed) {
      this.refuse(
        event,
        '(no target)',
        'the message carries no "target: " header'
      );
      return;
    }
    this.attempt(event, parsed.target, parsed.message);
  }

  private attempt(
    event: InboundMailEvent,
    target: string,
    message: string
  ): void {
    const resolved = this.resolveTarget(target);
    if (resolved.kind === 'refused') {
      this.refuse(event, target, resolved.reason);
      return;
    }
    if (this.deliver(resolved.key, message)) {
      this.ack(event.id);
      return;
    }
    this.refused.delete(event.id);
    this.waiting.set(event.id, {
      id: event.id,
      peerId: event.from,
      target,
      receivedAt: this.now(),
      key: resolved.key,
      message,
    });
    this.onChange();
  }

  private refuse(
    event: InboundMailEvent,
    target: string,
    reason: string
  ): void {
    this.refused.set(event.id, {
      id: event.id,
      peerId: event.from,
      target,
      reason,
      receivedAt: this.now(),
    });
    this.onChange();
  }

  private ack(id: string): void {
    this.waiting.delete(id);
    this.delivered.add(id);
    void this.port.ackInboundMail(id);
    this.onChange();
  }

  private retryWaiting(): void {
    for (const [id, item] of this.waiting) {
      if (this.deliver(item.key, item.message)) this.ack(id);
    }
  }

  /** What this machine has waiting or has refused from `peerId`, oldest
   *  first — the machines panel's per-machine overlay. */
  snapshotFor(peerId: string): {
    inboundWaiting: InboundMailItem[];
    inboundRefused: InboundMailItem[];
  } {
    const byPeer = <T extends InboundMailItem & { peerId: string }>(
      items: Iterable<T>
    ): InboundMailItem[] =>
      [...items]
        .filter((i) => i.peerId === peerId)
        .sort((a, b) => a.receivedAt - b.receivedAt)
        .map(({ id, target, reason, receivedAt }) => ({
          id,
          target,
          reason,
          receivedAt,
        }));
    return {
      inboundWaiting: byPeer(this.waiting.values()),
      inboundRefused: byPeer(this.refused.values()),
    };
  }

  /** Discards a refused item without delivering it — the only thing
   *  that acks a refusal, since the alternative is leaving it on disk
   *  forever. Removing it from the mailbox is exactly what dismissing
   *  means; the UI says so. A no-op for an id already gone. */
  dismiss(id: string): void {
    if (!this.refused.delete(id)) return;
    this.delivered.add(id);
    void this.port.ackInboundMail(id);
    this.onChange();
  }

  dispose(): void {
    clearInterval(this.timer);
  }
}
