import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { MailRelay } from './beam-mail-relay.js';
import type { InboundMailEvent } from './beam-node-mail.js';
import type { LocalDeliveryTarget } from '@n10/core';

function event(overrides: Partial<InboundMailEvent> = {}): InboundMailEvent {
  return {
    id: 'env-1',
    from: 'peer-1',
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
      },
    },
    push: (e: InboundMailEvent) => cb?.(e),
    acked,
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
    expect(relay.snapshotFor('peer-1')).toEqual({
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
    const waiting = relay.snapshotFor('peer-1').inboundWaiting;
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
    expect(relay.snapshotFor('peer-1').inboundWaiting).toEqual([]);
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
      const refused = relay.snapshotFor('peer-1').inboundRefused;
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
    expect(relay.snapshotFor('peer-1').inboundRefused).toEqual([]);
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
    expect(relay.snapshotFor('peer-1').inboundRefused).toHaveLength(1);
  });
});
