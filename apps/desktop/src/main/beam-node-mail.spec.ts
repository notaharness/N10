import { describe, expect, it, vi } from 'vitest';
import { InboundMailSubscriber } from './beam-node-mail.js';

interface FakeEnvelope {
  id: string;
  from: string;
  to: string;
  seq: number;
  topic: string;
  payload: string;
  encoding: 'utf8' | 'base64';
  createdAt: number;
}

function envelope(overrides: Partial<FakeEnvelope> = {}): FakeEnvelope {
  return {
    id: 'env-1',
    from: 'peer-1',
    to: 'me',
    seq: 1,
    topic: 'orchestra',
    payload: 'target: tmux:foo\n\nhi',
    encoding: 'utf8',
    createdAt: 1000,
    ...overrides,
  };
}

/** A fake `Mailbox` exposing only `subscribeInbound`, matching the
 *  library's real signature (handler receives an explicit `acknowledge`
 *  it must call once something has taken the envelope). */
function fakeMailbox(replay: FakeEnvelope[] = []) {
  let handler: ((e: FakeEnvelope, ack: () => void) => void) | undefined;
  const acked: string[] = [];
  return {
    mailbox: {
      subscribeInbound: (h: (e: FakeEnvelope, ack: () => void) => void) => {
        handler = h;
        for (const e of replay) h(e, () => acked.push(e.id));
        return () => {
          handler = undefined;
        };
      },
    },
    deliver(e: FakeEnvelope) {
      handler?.(e, () => acked.push(e.id));
    },
    acked,
  };
}

function fakePeers(records: { peerId: string; label: string }[]) {
  return { list: () => records };
}

describe('InboundMailSubscriber', () => {
  it('pushes every accepted envelope, resolving the sender to its label', () => {
    const { mailbox, deliver } = fakeMailbox();
    const peers = fakePeers([{ peerId: 'peer-1', label: 'workbox' }]);
    const sub = new InboundMailSubscriber(mailbox, peers);
    const cb = vi.fn();
    sub.onMail(cb);
    deliver(envelope());
    expect(cb).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'env-1',
        from: 'peer-1',
        fromLabel: 'workbox',
      })
    );
  });

  it('falls back to the raw peerId when the sender has no known label', () => {
    const { mailbox, deliver } = fakeMailbox();
    const sub = new InboundMailSubscriber(mailbox, fakePeers([]));
    const cb = vi.fn();
    sub.onMail(cb);
    deliver(envelope({ from: 'unknown-peer' }));
    expect(cb).toHaveBeenCalledWith(
      expect.objectContaining({ fromLabel: 'unknown-peer' })
    );
  });

  it('replays backlog still pending to a listener attaching after construction (startup drain)', () => {
    // `mailbox.subscribeInbound` replays its backlog synchronously,
    // inside this class's constructor — which returns before
    // `beam-node-worker.ts` can call `onMail`. A listener that only
    // adds itself to a `Set` and waits for the next live envelope would
    // therefore never see anything a restart left on disk; this is
    // exactly the "an envelope written to the inbound store while the
    // app is down is delivered after start" case the brief requires.
    const { mailbox } = fakeMailbox([envelope({ id: 'backlog-1' })]);
    const sub = new InboundMailSubscriber(mailbox, fakePeers([]));
    const cb = vi.fn();
    sub.onMail(cb);
    expect(cb).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'backlog-1' })
    );
  });

  it('does not replay an item to a new listener once it has already been acked', () => {
    const { mailbox, deliver } = fakeMailbox();
    const sub = new InboundMailSubscriber(mailbox, fakePeers([]));
    deliver(envelope({ id: 'env-1' }));
    sub.ack('env-1');
    const cb = vi.fn();
    sub.onMail(cb);
    expect(cb).not.toHaveBeenCalled();
  });

  it('replays pending backlog to every listener that attaches, not only the first', () => {
    const { mailbox } = fakeMailbox([envelope({ id: 'backlog-1' })]);
    const sub = new InboundMailSubscriber(mailbox, fakePeers([]));
    const first = vi.fn();
    const second = vi.fn();
    sub.onMail(first);
    sub.onMail(second);
    expect(first).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'backlog-1' })
    );
    expect(second).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'backlog-1' })
    );
  });

  it('ack(id) calls the mailbox acknowledge exactly once and reports success', () => {
    const { mailbox, deliver, acked } = fakeMailbox();
    const sub = new InboundMailSubscriber(mailbox, fakePeers([]));
    deliver(envelope());
    expect(sub.ack('env-1')).toBe(true);
    expect(acked).toEqual(['env-1']);
  });

  it('ack(id) is false and a no-op for an id it never saw or already acked', () => {
    const { mailbox, deliver, acked } = fakeMailbox();
    const sub = new InboundMailSubscriber(mailbox, fakePeers([]));
    deliver(envelope());
    expect(sub.ack('never-seen')).toBe(false);
    sub.ack('env-1');
    expect(sub.ack('env-1')).toBe(false);
    expect(acked).toEqual(['env-1']);
  });
});
