/**
 * Drains one peer's outbound queue over whichever live connection exists —
 * dialed or accepted, it does not matter (that symmetry is the whole point
 * of a queue keyed by peer, not by role). Strictly sequential: send one
 * envelope, await its ack, unlink, then the next. See docs/beam.md.
 */

import type { ConnectionRegistry } from '../connection-registry.js';
import type { PeerConnection } from '../connection.js';
import type { BeamStream } from '../stream.js';
import { isPermanentRefusal } from './ack-reasons.js';
import type { Envelope } from './envelope.js';
import type { OutboundQueue, QueuedEnvelope } from './outbound-queue.js';

/** What came back for one envelope: the peer's ack, or a synthesised
 * refusal with no reason when the ack timer expired first. `reason` is only
 * ever read through `isPermanentRefusal` — the flusher never branches on
 * the text itself. */
interface Ack {
  accepted: boolean;
  reason?: string;
}

interface MsgStreamState {
  stream: BeamStream;
  pending: Map<string, (ack: Ack) => void>;
}

export interface FlusherOptions {
  queue: OutboundQueue;
  connections: ConnectionRegistry;
  /** How long one envelope waits for its ack before the drain loop backs
   * off and retries (the "bounded retry while a connection stays up"). */
  ackTimeoutMs?: number;
  retryIntervalMs?: number;
  onDelivered?: (peerId: string, envelope: Envelope) => void;
  /** True if `peerId` is currently revoked. Checked on every turn of the
   * drain loop, not just at kick time: revoking a peer must stop queued
   * mail going out to it, not merely drop its live connections (D5) — a
   * revoke that races an in-flight drain, or one issued through the peer
   * table directly rather than through a path that also closes
   * connections, must still take effect immediately. */
  isRevoked?: (peerId: string) => boolean;
  log?: (message: string) => void;
}

const DEFAULT_ACK_TIMEOUT_MS = 5_000;
const DEFAULT_RETRY_INTERVAL_MS = 2_000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

export class Flusher {
  private readonly queue: OutboundQueue;
  private readonly connections: ConnectionRegistry;
  private readonly ackTimeoutMs: number;
  private readonly retryIntervalMs: number;
  private readonly onDelivered?: (peerId: string, envelope: Envelope) => void;
  private readonly isRevoked: (peerId: string) => boolean;
  private readonly log: (message: string) => void;
  private readonly active = new Set<string>();
  /** Peers kicked again while their drain was already running (or just
   * about to decide there was nothing to do) — checked when that drain
   * finishes so a kick arriving in that gap is never silently dropped. */
  private readonly recheck = new Set<string>();
  private readonly streams = new Map<string, MsgStreamState>();
  private disposed = false;

  constructor(options: FlusherOptions) {
    this.queue = options.queue;
    this.connections = options.connections;
    this.ackTimeoutMs = options.ackTimeoutMs ?? DEFAULT_ACK_TIMEOUT_MS;
    this.retryIntervalMs = options.retryIntervalMs ?? DEFAULT_RETRY_INTERVAL_MS;
    this.onDelivered = options.onDelivered;
    this.isRevoked = options.isRevoked ?? (() => false);
    this.log = options.log ?? (() => undefined);
  }

  /** Ask the flusher to (re)drain `peerId`'s queue if a connection exists.
   * If a drain for that peer is already running (including one about to
   * decide there is nothing left to do), this is remembered and rechecked
   * when that drain finishes, rather than silently dropped — a message
   * enqueued in the narrow gap between that drain's last scan and its exit
   * must still get sent without waiting for some unrelated future trigger. */
  kick(peerId: string): void {
    if (this.disposed) return;
    if (!this.connections.get(peerId)) return;
    if (this.active.has(peerId)) {
      this.recheck.add(peerId);
      return;
    }
    this.startDrain(peerId);
  }

  private startDrain(peerId: string): void {
    this.active.add(peerId);
    // `.catch` before `.finally`: a throw inside `drain` (e.g. a queue read
    // that raises) must be logged, not left to become an unhandled
    // rejection nobody awaits — `void` alone is not error handling.
    void this.drain(peerId)
      .catch((error) =>
        this.log(`drain for ${peerId} failed: ${(error as Error).message}`)
      )
      .finally(() => {
        this.active.delete(peerId);
        if (
          this.recheck.delete(peerId) &&
          !this.disposed &&
          this.connections.get(peerId)
        ) {
          this.startDrain(peerId);
        }
      });
  }

  dispose(): void {
    this.disposed = true;
  }

  private async drain(peerId: string): Promise<void> {
    for (;;) {
      if (this.disposed) return;
      // Revoking a peer must stop queued mail going out to it, not just
      // drop its connections (D5) — checked on every turn, not only at
      // kick time, so a revoke racing an in-flight drain still lands before
      // the next envelope goes out.
      if (this.isRevoked(peerId)) return;
      const connection = this.connections.get(peerId);
      if (!connection) return; // No connection right now; a future connect re-kicks.

      const next = this.queue.list(peerId)[0];
      if (!next) return; // Nothing left to drain.

      const state = await this.streamFor(peerId, connection);
      if (!state) {
        await delay(this.retryIntervalMs);
        continue;
      }

      const progressed = await this.stepEnvelope(peerId, state, next);
      if (!progressed) await delay(this.retryIntervalMs);
    }
  }

  /** Send one queued envelope; returns whether the loop made progress (an
   * unacked envelope is retried by the caller's delay, not treated as
   * done). */
  private async stepEnvelope(
    peerId: string,
    state: MsgStreamState,
    next: QueuedEnvelope
  ): Promise<boolean> {
    let ack: Ack;
    try {
      ack = await this.sendOne(state, next.envelope);
    } catch (error) {
      // The envelope cannot be put on the wire at all — an oversized
      // serialization, most likely. `drain` always takes the head of the
      // queue, so retrying it would block every message behind it forever
      // and re-throw out of every kick. Quarantine is what this queue
      // already does with a message it can never send: loud, durable, and
      // out of the way. See docs/beam.md on quarantine never being silent.
      return this.giveUpOn(
        peerId,
        next,
        `cannot be sent: ${(error as Error).message}`
      );
    }
    if (ack.accepted) {
      this.queue.remove(peerId, next.fileName);
      this.onDelivered?.(peerId, next.envelope);
      return true;
    }
    // A refusal the receiver will repeat for every resend — the payload is
    // over the cap — is the same situation as the local encode failure
    // above, reached from the other end: this envelope can never be
    // delivered, and `drain` always takes the head of the queue, so
    // leaving it there stalls every later message to this peer forever
    // while `send()` has already reported it `queued`. Same remedy, the
    // one this queue already has: quarantine it, loudly and durably
    // (ack-reasons.ts, and docs/beam.md on quarantine never being silent).
    if (isPermanentRefusal(ack.reason)) {
      return this.giveUpOn(peerId, next, `refused permanently: ${ack.reason}`);
    }
    // Everything else — an ack timeout, a full inbound queue, unreadable
    // seen state, a reason this version does not know — clears on its own
    // or with an operator's help, so the envelope keeps its place.
    const detail = ack.reason ? ` (${ack.reason})` : '';
    this.log(`msg to ${peerId} not acked${detail}; retrying while connected`);
    return false;
  }

  /** Move an undeliverable envelope out of the way. Reported as no
   * progress on purpose: quarantine is best-effort — if the rename aside
   * fails, this envelope is still the head of the queue next time round,
   * and claiming progress would spin the drain loop on it with nothing
   * between the turns. The loss reaches the caller the way every other
   * quarantine does — `OutboundQueue.onQuarantine`, which `Mailbox` logs,
   * forwards, and leaves discoverable through `quarantined()` across a
   * restart. */
  private giveUpOn(
    peerId: string,
    next: QueuedEnvelope,
    reason: string
  ): boolean {
    this.log(`msg to ${peerId} ${reason}; quarantining it`);
    this.queue.quarantineFile(peerId, next.fileName, reason);
    return false;
  }

  private async streamFor(
    peerId: string,
    connection: PeerConnection
  ): Promise<MsgStreamState | null> {
    const cached = this.streams.get(peerId);
    if (cached) return cached;
    try {
      const stream = await connection.openStream('msg');
      const state: MsgStreamState = { stream, pending: new Map() };
      stream.onControl((message) => this.handleAck(state, message));
      stream.onClose(() => {
        if (this.streams.get(peerId) === state) this.streams.delete(peerId);
      });
      this.streams.set(peerId, state);
      return state;
    } catch (error) {
      this.log(
        `could not open msg stream to ${peerId}: ${(error as Error).message}`
      );
      return null;
    }
  }

  private handleAck(
    state: MsgStreamState,
    message: Record<string, unknown>
  ): void {
    if (message['kind'] !== 'ack' || typeof message['id'] !== 'string') return;
    const resolve = state.pending.get(message['id']);
    if (!resolve) return;
    state.pending.delete(message['id']);
    // `reason` is carried through rather than dropped: it is the only
    // thing that tells a refusal that will clear from one that never
    // will. Anything that is not a string arrives as absent, which
    // `isPermanentRefusal` reads as transient.
    resolve({
      accepted: message['accepted'] === true,
      reason:
        typeof message['reason'] === 'string' ? message['reason'] : undefined,
    });
  }

  private awaitAck(
    state: MsgStreamState,
    key: string,
    send: () => void
  ): Promise<Ack> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (ack: Ack): void => {
        if (settled) return;
        settled = true;
        state.pending.delete(key);
        resolve(ack);
      };
      // No reason on a timeout: silence says nothing about whether a
      // resend would fare differently, so it is transient by default.
      const timer = setTimeout(
        () => finish({ accepted: false }),
        this.ackTimeoutMs
      );
      timer.unref?.();
      state.pending.set(key, (ack) => {
        clearTimeout(timer);
        finish(ack);
      });
      try {
        send();
      } catch (error) {
        // Nothing went out, so no ack is ever coming: drop the waiter and
        // its timer rather than leaving them to expire, and let the caller
        // decide what to do with an envelope that will not encode.
        clearTimeout(timer);
        state.pending.delete(key);
        settled = true;
        reject(error as Error);
      }
    });
  }

  private sendOne(state: MsgStreamState, envelope: Envelope): Promise<Ack> {
    return this.awaitAck(state, envelope.id, () =>
      state.stream.write(new TextEncoder().encode(JSON.stringify(envelope)))
    );
  }
}
