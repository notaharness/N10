import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { MailRelay, type RelayPort } from './beam-mail-relay.js';
import type { InboundMailEvent } from './beam-node-mail.js';
import type { LocalDeliveryTarget } from '@n10/core';

function event(overrides: Partial<InboundMailEvent> = {}): InboundMailEvent {
  return {
    id: 'env-1',
    from: 'bbbbbbbbbbbbbbbb',
    fromLabel: 'workbox',
    topic: 'orchestra',
    payload: 'target: tmux:n10-feature-x\n\nhello there',
    encoding: 'utf8',
    createdAt: 1000,
    ...overrides,
  };
}

function fakePort() {
  let cb: ((event: InboundMailEvent) => void) | undefined;
  const acked: string[] = [];
  return {
    port: {
      onInboundMail: (fn: (event: InboundMailEvent) => void) => {
        cb = fn;
        return () => {
          cb = undefined;
        };
      },
      ackInboundMail: async (id: string) => {
        acked.push(id);
        return true;
      },
    },
    push: (e: InboundMailEvent) => cb?.(e),
    acked,
  };
}

/**
 * Models the durable mailbox itself, not just one app run's port: an
 * envelope stays here until `ackInboundMail` for its id actually
 * succeeds, and `restart()` hands back a fresh port wired to the same
 * store — the same one a real app restart would reconnect to, drained
 * (docs/beam.md) exactly like `InboundMailSubscriber.onMail` replays
 * whatever it still holds unacked. `failAcksFor(id, n)` makes the next
 * `n` ack attempts for that id reject, as a worker exit/shutdown/spent
 * restart budget would (finding 2).
 */
function fakeMailbox() {
  const durable = new Map<string, InboundMailEvent>();
  const failuresLeft = new Map<string, number>();
  let cb: ((event: InboundMailEvent) => void) | undefined;
  return {
    push(e: InboundMailEvent) {
      durable.set(e.id, e);
      cb?.(e);
    },
    failAcksFor(id: string, n: number) {
      failuresLeft.set(id, n);
    },
    isDurable(id: string) {
      return durable.has(id);
    },
    restart(): RelayPort {
      cb = undefined;
      return {
        onInboundMail: (fn) => {
          cb = fn;
          for (const event of durable.values()) fn(event);
          return () => {
            cb = undefined;
          };
        },
        ackInboundMail: async (id: string) => {
          const remaining = failuresLeft.get(id) ?? 0;
          if (remaining > 0) {
            failuresLeft.set(id, remaining - 1);
            throw new Error('beam node exited unexpectedly (1)');
          }
          durable.delete(id);
          return true;
        },
      };
    },
  };
}

describe('MailRelay', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('delivers and acks only after a successful delivery', () => {
    const { port, push, acked } = fakePort();
    const resolveTarget = vi.fn(
      (): LocalDeliveryTarget => ({ kind: 'agent', key: 'key-1' })
    );
    const deliver = vi.fn(() => true);
    const relay = new MailRelay({ port, resolveTarget, deliver });
    push(event());
    expect(deliver).toHaveBeenCalledWith('key-1', 'hello there');
    expect(acked).toEqual(['env-1']);
    expect(relay.snapshotFor('bbbbbbbbbbbbbbbb')).toEqual({
      inboundWaiting: [],
      inboundRefused: [],
    });
  });

  it('a failed delivery leaves the envelope unacked and waiting, never delivered a second time on its own', () => {
    const { port, push, acked } = fakePort();
    const resolveTarget = vi.fn(
      (): LocalDeliveryTarget => ({ kind: 'agent', key: 'key-1' })
    );
    const deliver = vi.fn(() => false);
    const relay = new MailRelay({ port, resolveTarget, deliver });
    push(event());
    expect(acked).toEqual([]);
    const waiting = relay.snapshotFor('bbbbbbbbbbbbbbbb').inboundWaiting;
    expect(waiting).toHaveLength(1);
    expect(waiting[0]).toMatchObject({
      id: 'env-1',
      target: 'tmux:n10-feature-x',
    });
  });

  it('retries a waiting envelope on a timer and acks once it connects', () => {
    const { port, push, acked } = fakePort();
    const resolveTarget = vi.fn(
      (): LocalDeliveryTarget => ({ kind: 'agent', key: 'key-1' })
    );
    let connected = false;
    const deliver = vi.fn(() => connected);
    const relay = new MailRelay({
      port,
      resolveTarget,
      deliver,
      retryIntervalMs: 1000,
    });
    push(event());
    expect(acked).toEqual([]);
    connected = true;
    vi.advanceTimersByTime(1000);
    expect(acked).toEqual(['env-1']);
    expect(relay.snapshotFor('bbbbbbbbbbbbbbbb').inboundWaiting).toEqual([]);
  });

  // ── Finding 3 (MEDIUM-HIGH): a retry must re-resolve, not reuse a
  // cached key. Registry keys for terminals are the tmux name itself,
  // and the create path reuses a freed name for its next session, so
  // trusting the key `attempt` resolved once could redeliver into
  // whatever now holds that name after the original was killed and
  // replaced.

  it('re-resolves the target on every retry instead of reusing the key from the first attempt', () => {
    const { port, push } = fakePort();
    let resolution: LocalDeliveryTarget = { kind: 'agent', key: 'old-key' };
    const resolveTarget = vi.fn(() => resolution);
    const deliver = vi.fn(() => false);
    new MailRelay({ port, resolveTarget, deliver, retryIntervalMs: 1000 });
    push(event());
    expect(deliver).toHaveBeenLastCalledWith('old-key', 'hello there');

    // The tmux name was freed and reused by an unrelated new session,
    // which now resolves to a different registry key.
    resolution = { kind: 'agent', key: 'new-key' };
    deliver.mockReturnValue(true);
    vi.advanceTimersByTime(1000);

    // Called once with the original key (the first attempt) and once
    // more with the freshly re-resolved key (the retry) — never twice
    // with the stale one.
    expect(deliver).toHaveBeenCalledTimes(2);
    expect(deliver).toHaveBeenLastCalledWith('new-key', 'hello there');
  });

  it('refuses instead of delivering when a retry finds the recycled name no longer a valid target', () => {
    const { port, push, acked } = fakePort();
    let resolution: LocalDeliveryTarget = { kind: 'agent', key: 'old-key' };
    const resolveTarget = vi.fn(() => resolution);
    const deliver = vi.fn(() => false);
    const relay = new MailRelay({
      port,
      resolveTarget,
      deliver,
      retryIntervalMs: 1000,
    });
    push(event());
    expect(relay.snapshotFor('bbbbbbbbbbbbbbbb').inboundWaiting).toHaveLength(
      1
    );

    // The freed tmux name is now a shell terminal, not an agent.
    resolution = {
      kind: 'refused',
      reason: 'that session is a shell terminal, not an agent',
    };
    vi.advanceTimersByTime(1000);

    expect(deliver).toHaveBeenCalledTimes(1); // only the first attempt
    expect(acked).toEqual([]);
    expect(relay.snapshotFor('bbbbbbbbbbbbbbbb').inboundWaiting).toEqual([]);
    expect(relay.snapshotFor('bbbbbbbbbbbbbbbb').inboundRefused).toMatchObject([
      { reason: 'that session is a shell terminal, not an agent' },
    ]);
  });

  it('refuses without acking for each way a target must not receive mail', () => {
    const cases: { reason: string }[] = [
      { reason: 'no session by that name is known here' },
      { reason: 'that tmux session exists but is not managed by n10' },
      { reason: 'that session is a shell terminal, not an agent' },
      { reason: 'that session lives on another machine, not here' },
    ];
    for (const { reason } of cases) {
      const { port, push, acked } = fakePort();
      const resolveTarget = vi.fn(
        (): LocalDeliveryTarget => ({ kind: 'refused', reason })
      );
      const deliver = vi.fn();
      const relay = new MailRelay({ port, resolveTarget, deliver });
      push(event());
      expect(deliver).not.toHaveBeenCalled();
      expect(acked).toEqual([]);
      const refused = relay.snapshotFor('bbbbbbbbbbbbbbbb').inboundRefused;
      expect(refused).toHaveLength(1);
      expect(refused[0]).toMatchObject({
        target: 'tmux:n10-feature-x',
        reason,
      });
    }
  });

  it('never redelivers the same envelope id once it has been acked', () => {
    const { port, push, acked } = fakePort();
    const resolveTarget = vi.fn(
      (): LocalDeliveryTarget => ({ kind: 'agent', key: 'key-1' })
    );
    const deliver = vi.fn(() => true);
    new MailRelay({ port, resolveTarget, deliver });
    push(event());
    push(event()); // the same envelope id, as a mailbox-level redelivery would look
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(acked).toEqual(['env-1']);
  });

  it('a refused item can be dismissed, which acks it (deleting it from the mailbox)', () => {
    const { port, push, acked } = fakePort();
    const resolveTarget = vi.fn(
      (): LocalDeliveryTarget => ({ kind: 'refused', reason: 'nope' })
    );
    const relay = new MailRelay({ port, resolveTarget, deliver: vi.fn() });
    push(event());
    expect(acked).toEqual([]);
    relay.dismiss('env-1');
    expect(acked).toEqual(['env-1']);
    expect(relay.snapshotFor('bbbbbbbbbbbbbbbb').inboundRefused).toEqual([]);
  });

  // Finding 6 (LOW): the constructor discarded the unsubscribe
  // `onInboundMail` returns, so `dispose()` only cleared the timer —
  // latent today (one construction site), but a disposed relay must
  // stop listening, or a second one would double-deliver every
  // envelope.
  it('stops listening for inbound mail once disposed', () => {
    const { port, push } = fakePort();
    const resolveTarget = vi.fn(
      (): LocalDeliveryTarget => ({ kind: 'agent', key: 'key-1' })
    );
    const deliver = vi.fn(() => true);
    const relay = new MailRelay({ port, resolveTarget, deliver });
    relay.dispose();
    push(event());
    expect(deliver).not.toHaveBeenCalled();
  });

  // ── The boundary where a peer's bytes become keystrokes in a local
  // pane: bounded and filtered here, whatever the layer below did.

  it('strips the control characters a terminal would act on', () => {
    const { port, push } = fakePort();
    const deliver = vi.fn(() => true);
    new MailRelay({
      port,
      resolveTarget: () => ({ kind: 'agent', key: 'key-1' }),
      deliver,
    });
    push(
      event({
        payload:
          'target: tmux:n10-feature-x\n\nbuild \x1b[31mfailed\x07\rrm -rf ~\ttab\nnext line',
      })
    );
    // ESC and BEL gone, so nothing here can drive the terminal; the
    // lone CR is a newline rather than a submit in the middle of
    // somebody else's message; tabs and newlines survive, because a
    // report is text.
    expect(deliver).toHaveBeenCalledWith(
      'key-1',
      'build [31mfailed\nrm -rf ~\ttab\nnext line'
    );
  });

  it('refuses a message past the size cap instead of delivering part of it', () => {
    const { port, push, acked } = fakePort();
    const deliver = vi.fn(() => true);
    const relay = new MailRelay({
      port,
      resolveTarget: () => ({ kind: 'agent', key: 'key-1' }),
      deliver,
    });
    push(
      event({
        payload: `target: tmux:n10-feature-x\n\n${'a'.repeat(64 * 1024)}`,
      })
    );
    expect(deliver).not.toHaveBeenCalled();
    // Unacked and visible as refused — never silently truncated, and
    // never quietly dropped either.
    expect(acked).toEqual([]);
    expect(relay.snapshotFor('bbbbbbbbbbbbbbbb').inboundRefused).toMatchObject([
      { reason: expect.stringContaining('larger than') },
    ]);
  });

  it('does not re-rule on an id it has already refused when the mailbox replays it', () => {
    const { port, push } = fakePort();
    const resolveTarget = vi.fn(
      (): LocalDeliveryTarget => ({ kind: 'refused', reason: 'nope' })
    );
    const relay = new MailRelay({ port, resolveTarget, deliver: vi.fn() });
    push(event());
    // A refusal stays on disk until someone dismisses it, so every
    // subscribe replays it — that must not re-enter the decision.
    push(event());
    expect(resolveTarget).toHaveBeenCalledTimes(1);
    expect(relay.snapshotFor('bbbbbbbbbbbbbbbb').inboundRefused).toHaveLength(
      1
    );
  });

  it('an envelope with no "target: " header is refused, not guessed', () => {
    const { port, push, acked } = fakePort();
    const relay = new MailRelay({
      port,
      resolveTarget: vi.fn(),
      deliver: vi.fn(),
    });
    push(event({ payload: 'no header here' }));
    expect(acked).toEqual([]);
    expect(relay.snapshotFor('bbbbbbbbbbbbbbbb').inboundRefused).toHaveLength(
      1
    );
  });

  // ── Finding 2 (HIGH): a lost ack must not become a second delivery ──

  it('retries an ack that rejects (worker exit/shutdown/spent restart budget) instead of leaving it unhandled', async () => {
    const mailbox = fakeMailbox();
    mailbox.failAcksFor('env-1', 1);
    const resolveTarget = vi.fn(
      (): LocalDeliveryTarget => ({ kind: 'agent', key: 'key-1' })
    );
    const deliver = vi.fn(() => true);
    const relay = new MailRelay({
      port: mailbox.restart(),
      resolveTarget,
      deliver,
      retryIntervalMs: 1000,
    });
    mailbox.push(event());
    // The delivery itself succeeded; only the ack rejected.
    expect(deliver).toHaveBeenCalledTimes(1);
    // Rejected, not yet confirmed — the envelope is still on disk.
    expect(mailbox.isDurable('env-1')).toBe(true);

    await vi.advanceTimersByTimeAsync(1000);

    // The next retry sweep resent the ack and it landed this time.
    expect(mailbox.isDurable('env-1')).toBe(false);
    relay.dispose();
  });

  it('does not redeliver into the agent a second time across a simulated app restart, even after a failed ack', async () => {
    const mailbox = fakeMailbox();
    // Simulates the concrete scenario: report delivered, worker exits
    // before processing ackMail, budget allows a restart, then this
    // app instance (not just the worker) restarts.
    mailbox.failAcksFor('env-1', 1);
    const resolveTarget = vi.fn(
      (): LocalDeliveryTarget => ({ kind: 'agent', key: 'key-1' })
    );
    const deliver = vi.fn(() => true);
    const first = new MailRelay({
      port: mailbox.restart(),
      resolveTarget,
      deliver,
      retryIntervalMs: 1000,
    });
    mailbox.push(event());
    expect(deliver).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000); // ack retried and confirmed
    expect(mailbox.isDurable('env-1')).toBe(false);
    first.dispose();

    // "Next app start": a fresh MailRelay with empty in-memory state,
    // reconnected to the same durable mailbox — which now drains
    // nothing for env-1, since it was actually acked before restart.
    new MailRelay({
      port: mailbox.restart(),
      resolveTarget,
      deliver,
      retryIntervalMs: 1000,
    });
    expect(deliver).toHaveBeenCalledTimes(1);
  });
});
