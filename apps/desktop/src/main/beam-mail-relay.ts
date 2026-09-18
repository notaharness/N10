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
  /** `false` for "already acked or never seen" (docs/beam.md's two-
   *  acknowledgement table) — not success, and not distinguished here
   *  from a rejection: either way the caller must keep the envelope
   *  live and retry. */
  ackInboundMail(id: string): Promise<boolean>;
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
  /** Envelope ids already delivered — added the instant `deliver()`
   *  returns true, before the ack is even sent, so a mailbox-level
   *  redelivery (a worker restart replaying its backlog before our ack
   *  has landed, or any other at-least-once duplicate) can never reach
   *  `deliver()` twice for the same report within this run. Ids stay
   *  here whether or not their ack has actually been confirmed yet —
   *  see `pendingAck`. */
  private readonly delivered = new Set<string>();
  /** Delivered (or dismissed) ids whose ack has not yet been confirmed
   *  by the mailbox: `ackInboundMail` rejected (the worker exited, is
   *  shutting down, or the restart budget is spent) or resolved
   *  `false` ("already acked or never seen" — not success either).
   *  `void`-ing that promise, as this used to, is not error handling
   *  (AGENTS.md): unhandled here it is an unhandled rejection in main,
   *  and worse, the envelope stays on disk — `delivered` above
   *  suppresses redelivery only for the rest of *this* run, so an app
   *  restart's fresh, empty `delivered` set would let the mailbox
   *  replay it and paste the same report into the agent a second time
   *  (finding 2). Retried by the same sweep that retries `waiting`,
   *  until it actually confirms. */
  private readonly pendingAck = new Set<string>();
  private readonly timer: ReturnType<typeof setInterval>;
  private readonly unsubscribe: () => void;

  constructor(options: MailRelayOptions) {
    this.port = options.port;
    this.resolveTarget = options.resolveTarget ?? resolveLocalRelayTarget;
    this.deliver = options.deliver ?? deliverToRunningSession;
    this.now = options.now ?? Date.now;
    this.onChange = options.onChange ?? (() => undefined);
    this.unsubscribe = this.port.onInboundMail((event) => this.handle(event));
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
        event.id,
        event.from,
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
      this.refuse(event.id, event.from, target, resolved.reason);
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
      message,
    });
    this.onChange();
  }

  private refuse(
    id: string,
    peerId: string,
    target: string,
    reason: string
  ): void {
    this.refused.set(id, {
      id,
      peerId,
      target,
      reason,
      receivedAt: this.now(),
    });
    this.onChange();
  }

  private ack(id: string): void {
    this.waiting.delete(id);
    this.delivered.add(id);
    this.sendAck(id);
    this.onChange();
  }

  /** Send (or resend) the ack for an id already in `delivered`, and
   *  handle whatever comes back: `true` confirms it, anything else —
   *  a rejection or a `false` — leaves it in `pendingAck` for the next
   *  retry sweep. Never left unhandled. */
  private sendAck(id: string): void {
    this.pendingAck.add(id);
    this.port.ackInboundMail(id).then(
      (acked) => {
        if (!acked) return; // Not confirmed; retried on the next sweep.
        this.pendingAck.delete(id);
        this.onChange();
      },
      () => undefined // Rejected; retried on the next sweep.
    );
  }

  private retryWaiting(): void {
    // Snapshot before the loop below adds this sweep's own fresh acks —
    // those were just sent and deserve a full interval before a resend,
    // same as everything else here.
    const staleAcks = [...this.pendingAck];
    for (const [id, item] of this.waiting) {
      // Re-resolve on every attempt (D14) rather than trust the key
      // `attempt` cached: a registry key for a terminal is the tmux
      // name itself, and the create path hands a freed name to the
      // next session opened — a cached key could redeliver a
      // stranger's report into whatever now holds that name (finding
      // 3). Re-resolving also re-validates it (still an n10 agent, still
      // local), so a target that has since become invalid is refused
      // instead of blindly written into.
      const resolved = this.resolveTarget(item.target);
      if (resolved.kind === 'refused') {
        this.waiting.delete(id);
        this.refuse(id, item.peerId, item.target, resolved.reason);
        continue;
      }
      if (this.deliver(resolved.key, item.message)) this.ack(id);
    }
    for (const id of staleAcks) this.sendAck(id);
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
    this.sendAck(id);
    this.onChange();
  }

  dispose(): void {
    clearInterval(this.timer);
    this.unsubscribe();
  }
}
