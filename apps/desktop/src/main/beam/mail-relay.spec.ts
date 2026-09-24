import type { ClaudePost, LocalDeliveryTarget } from '@n10/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Envelope } from './mail-envelope.js';
import { MailRelay } from './mail-relay.js';
import {
  FakeDaemon,
  FakeOpError,
  type Request,
} from './test-support/fake-daemon.js';
import { until } from './test-support/until.js';

const PEER = 'b'.repeat(32);

function envelope(id: string, text: string): Envelope {
  return { id, from: PEER, payload: text, encoding: 'utf8' };
}

let daemon: FakeDaemon;
/** Envelopes the fake offers on every msg.subscribe until acked. */
let inbound: Envelope[];
let settled: Request[];
/** The `peers` pages the fake answers, the sender granted `all`. */
let peerPages: { peerId: string; grant: string }[][];
beforeEach(async () => {
  daemon = await FakeDaemon.start();
  inbound = [];
  settled = [];
  peerPages = [[{ peerId: PEER, grant: 'all' }]];
  daemon.on('peers', (req) => {
    const at = Number(req.cursor ?? 0);
    return {
      peers: peerPages[at],
      ...(at + 1 < peerPages.length ? { next: String(at + 1) } : {}),
    };
  });
  daemon.on('msg.subscribe', (_req, conn) => {
    setTimeout(() => {
      for (const e of inbound) conn.emit('mail', e);
    }, 0);
    return {};
  });
  daemon.on('msg.ack', (req) => {
    settled.push(req);
    inbound = inbound.filter((e) => e.id !== req.envelopeId);
    return {};
  });
  daemon.on('msg.defer', (req) => {
    settled.push(req);
    return {};
  });
});
afterEach(async () => {
  await daemon.close();
});

function relay(opts: {
  resolve?: (target: string) => LocalDeliveryTarget;
  deliver?: (key: string, message: string) => boolean;
  retryMs?: number;
  onChange?: () => void;
  postToClaude?: (sessionId: string, text: string) => Promise<ClaudePost>;
}): MailRelay {
  return new MailRelay({
    socketPath: daemon.socketPath,
    resolveTarget:
      opts.resolve ?? (() => ({ kind: 'agent', key: 'key-of-target' })),
    deliver: opts.deliver ?? (() => true),
    retryMs: opts.retryMs ?? 60_000,
    now: () => 1000,
    onChange: opts.onChange,
    postToClaude: opts.postToClaude,
  });
}

describe('MailRelay', () => {
  it('subscribes to orchestra mail, types a delivery into the pane and acks it', async () => {
    const typed: [string, string][] = [];
    inbound = [envelope('e1', 'target: tmux:agent\n\nhello\x1b[31m red\r\n')];
    const r = relay({ deliver: (key, msg) => (typed.push([key, msg]), true) });
    await r.start(() => undefined);
    await until(() => settled.length === 1);
    expect(daemon.requests('msg.subscribe')[0]).toMatchObject({
      topic: 'orchestra',
    });
    expect(typed).toEqual([['key-of-target', 'hello[31m red\n']]);
    expect(settled[0]).toMatchObject({ op: 'msg.ack', envelopeId: 'e1' });
    r.stop();
  });

  it('decodes a base64url payload before reading its target', async () => {
    const text = 'target: tmux:agent\n\nbytes';
    inbound = [
      {
        ...envelope('e1', ''),
        payload: Buffer.from(text).toString('base64url'),
        encoding: 'base64',
      },
    ];
    const typed: string[] = [];
    const r = relay({ deliver: (_k, msg) => (typed.push(msg), true) });
    await r.start(() => undefined);
    await until(() => settled.length === 1);
    expect(typed).toEqual(['bytes']);
    r.stop();
  });

  it('defers a refused target with its reason and lists it as refused', async () => {
    inbound = [envelope('e1', 'target: tmux:someone-else\n\nhi')];
    const r = relay({
      resolve: () => ({ kind: 'refused', reason: 'not managed by n10' }),
    });
    await r.start(() => undefined);
    await until(() => settled.length === 1);
    expect(settled[0]).toMatchObject({
      op: 'msg.defer',
      envelopeId: 'e1',
      reason: 'not managed by n10',
    });
    expect(r.snapshotFor(PEER)).toEqual({
      inboundWaiting: [],
      inboundRefused: [
        {
          id: 'e1',
          target: 'tmux:someone-else',
          reason: 'not managed by n10',
          receivedAt: 1000,
        },
      ],
    });
    r.stop();
  });

  it('forgets what it held from an enrolment that has ended', async () => {
    inbound = [
      envelope('e1', 'target: tmux:x\n\nhi'),
      envelope('e2', 'target: tmux:y\n\nhi'),
    ];
    const r = relay({
      resolve: (target) =>
        target === 'tmux:x'
          ? { kind: 'refused', reason: 'shell terminal' }
          : { kind: 'agent', key: 'key-of-target' },
      deliver: () => false,
    });
    await r.start(() => undefined);
    await until(() => settled.length === 2);
    expect(r.snapshotFor(PEER).inboundWaiting).toHaveLength(1);
    expect(r.snapshotFor(PEER).inboundRefused).toHaveLength(1);
    r.stop();
    r.forget();
    expect(r.snapshotFor(PEER)).toEqual({
      inboundWaiting: [],
      inboundRefused: [],
    });
  });

  it('dismissing a refusal acks it on the next offer without typing it', async () => {
    inbound = [envelope('e1', 'target: tmux:x\n\nhi')];
    let typed = 0;
    const r = relay({
      resolve: () => ({ kind: 'refused', reason: 'shell terminal' }),
      deliver: () => (typed++, true),
    });
    await r.start(() => undefined);
    // Only a listed refusal can be dismissed.
    await until(() => r.snapshotFor(PEER).inboundRefused.length === 1);
    r.dismiss('e1');
    await until(() => settled.length === 2);
    expect(settled[1]).toMatchObject({ op: 'msg.ack', envelopeId: 'e1' });
    expect(typed).toBe(0);
    expect(r.snapshotFor(PEER).inboundRefused).toEqual([]);
    r.stop();
  });

  it('defers a target that is not connected yet, and delivers it on a later subscription', async () => {
    inbound = [envelope('e1', 'target: tmux:agent\n\nlater')];
    let connected = false;
    const r = relay({ deliver: () => connected, retryMs: 20 });
    await r.start(() => undefined);
    await until(() => settled.length === 1);
    expect(settled[0]).toMatchObject({
      op: 'msg.defer',
      reason: 'waiting for tmux:agent to connect',
    });
    expect(r.snapshotFor(PEER).inboundWaiting).toHaveLength(1);
    connected = true;
    await until(() => settled.some((s) => s.op === 'msg.ack'));
    expect(daemon.requests('msg.subscribe').length).toBeGreaterThan(1);
    expect(r.snapshotFor(PEER).inboundWaiting).toEqual([]);
    r.stop();
  });

  it('never types an envelope twice when its ack was lost and it comes back', async () => {
    const typed: string[] = [];
    let acks = 0;
    daemon.on('msg.ack', (req) => {
      settled.push(req);
      if (++acks === 1) throw new Error('lost');
      inbound = inbound.filter((e) => e.id !== req.envelopeId);
      return {};
    });
    // e2 waits for its pane, so the relay subscribes again, and beam
    // offers e1 with it: its first ack never landed.
    inbound = [
      envelope('e1', 'target: tmux:agent\n\nonce'),
      envelope('e2', 'target: tmux:other\n\nwait'),
    ];
    const r = relay({
      deliver: (_key, msg) =>
        msg === 'once' ? (typed.push(msg), true) : false,
      retryMs: 20,
    });
    await r.start(() => undefined);
    await until(() => acks === 2);
    expect(typed).toEqual(['once']);
    r.stop();
  });

  it('keeps relaying after one envelope fails to resolve', async () => {
    inbound = [
      envelope('e1', 'target: tmux:broken\n\nhi'),
      envelope('e2', 'target: tmux:agent\n\nhi'),
    ];
    const r = relay({
      resolve: (target) => {
        if (target === 'tmux:broken') throw new Error('registry bug');
        return { kind: 'agent', key: 'key-of-target' };
      },
    });
    await r.start(() => undefined);
    await until(() => settled.length === 2);
    expect(settled[0]).toMatchObject({ op: 'msg.defer', envelopeId: 'e1' });
    expect(settled[1]).toMatchObject({ op: 'msg.ack', envelopeId: 'e2' });
    r.stop();
  });

  it('keeps relaying after a change notification throws', async () => {
    inbound = [
      envelope('e1', 'target: tmux:agent\n\nhi'),
      envelope('e2', 'target: tmux:agent\n\nhi'),
    ];
    const r = relay({
      onChange: () => {
        throw new Error('window gone');
      },
    });
    await r.start(() => undefined);
    await until(() => settled.length === 2);
    r.stop();
    expect(settled.map((s) => s.op)).toEqual(['msg.ack', 'msg.ack']);
  });

  it('answers a refusal offered again without resolving its target again', async () => {
    inbound = [
      envelope('e1', 'target: tmux:gone\n\nhi'),
      envelope('e2', 'target: tmux:later\n\nhi'),
    ];
    const resolved: string[] = [];
    const r = relay({
      resolve: (target) => {
        resolved.push(target);
        return target === 'tmux:gone'
          ? { kind: 'refused', reason: 'no session by that name' }
          : { kind: 'agent', key: 'later' };
      },
      deliver: () => false,
      retryMs: 5,
    });
    await r.start(() => undefined);
    await until(() => settled.length >= 4);
    r.stop();
    expect(resolved.filter((t) => t === 'tmux:gone')).toEqual(['tmux:gone']);
    expect(settled[2]).toMatchObject({
      op: 'msg.defer',
      envelopeId: 'e1',
      reason: 'no session by that name',
    });
  });

  it('does not subscribe once stopped while still connecting', async () => {
    const r = relay({});
    const started = r.start(() => undefined);
    r.stop();
    await started;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(daemon.requests('msg.subscribe')).toHaveLength(0);
  });

  it('closes its connection when the subscribe is refused', async () => {
    daemon.on('msg.subscribe', () => {
      throw new FakeOpError('not-enrolled');
    });
    const r = relay({});
    await expect(r.start(() => undefined)).rejects.toThrow(/not-enrolled/);
    await until(() => daemon.controls[0].socket.destroyed);
  });

  it('posts a claude target to that session’s inbox and acks it', async () => {
    const id = '3f2b9c1e-7a4d-4e8b-9c0f-1a2b3c4d5e6f';
    inbound = [envelope('e1', `target: claude:${id}\n\nreport`)];
    const posted: [string, string][] = [];
    const r = relay({
      resolve: () => ({ kind: 'claude', sessionId: id }),
      postToClaude: async (sessionId, text) => {
        posted.push([sessionId, text]);
        return 'delivered';
      },
    });
    await r.start(() => undefined);
    await until(() => settled.length === 1);
    expect(posted).toEqual([[id, 'report']]);
    expect(settled[0]).toMatchObject({ op: 'msg.ack', envelopeId: 'e1' });
    r.stop();
  });

  it('holds a claude target whose session is not live, and retries it', async () => {
    const id = '3f2b9c1e-7a4d-4e8b-9c0f-1a2b3c4d5e6f';
    inbound = [envelope('e1', `target: claude:${id}\n\nreport`)];
    const answers: ClaudePost[] = ['not-live', 'delivered'];
    const r = relay({
      resolve: () => ({ kind: 'claude', sessionId: id }),
      postToClaude: async () => answers.shift() ?? 'delivered',
      retryMs: 5,
    });
    await r.start(() => undefined);
    await until(() => settled.length === 2);
    expect(settled[0]).toMatchObject({
      op: 'msg.defer',
      reason: `waiting for claude:${id} to connect`,
    });
    expect(settled[1]).toMatchObject({ op: 'msg.ack', envelopeId: 'e1' });
    r.stop();
  });

  it('refuses a claude target no registry names', async () => {
    const id = '3f2b9c1e-7a4d-4e8b-9c0f-1a2b3c4d5e6f';
    inbound = [envelope('e1', `target: claude:${id}\n\nreport`)];
    const r = relay({
      resolve: () => ({ kind: 'claude', sessionId: id }),
      postToClaude: async () => 'unregistered',
    });
    await r.start(() => undefined);
    await until(() => settled.length === 1);
    expect(settled[0]).toMatchObject({
      op: 'msg.defer',
      reason: 'no Claude session by that id is registered here',
    });
    expect(r.snapshotFor(PEER).inboundRefused).toHaveLength(1);
    r.stop();
  });

  it('types nothing for a sender granted only mail', async () => {
    peerPages = [[{ peerId: PEER, grant: 'msg' }]];
    inbound = [envelope('e1', 'target: tmux:agent\n\nhi')];
    let typed = 0;
    const r = relay({ deliver: () => (typed++, true) });
    await r.start(() => undefined);
    await until(() => settled.length === 1);
    expect(settled[0]).toMatchObject({
      op: 'msg.defer',
      reason:
        'this machine grants the sender "msg", which does not deliver into a session; "all" does',
    });
    expect(typed).toBe(0);
    expect(r.snapshotFor(PEER).inboundRefused).toHaveLength(1);
    r.stop();
  });

  it('posts nothing to a live Claude session for a sender granted only mail', async () => {
    peerPages = [[{ peerId: PEER, grant: 'msg' }]];
    const id = '3f2b9c1e-7a4d-4e8b-9c0f-1a2b3c4d5e6f';
    inbound = [envelope('e1', `target: claude:${id}\n\nreport`)];
    let posted = 0;
    const r = relay({
      resolve: () => ({ kind: 'claude', sessionId: id }),
      postToClaude: async () => (posted++, 'delivered'),
    });
    await r.start(() => undefined);
    await until(() => settled.length === 1);
    expect(settled[0]).toMatchObject({ op: 'msg.defer' });
    expect(String(settled[0].reason)).toMatch(/grants the sender "msg"/);
    expect(posted).toBe(0);
    r.stop();
  });

  it('reads every page of peers for the sender’s grant', async () => {
    peerPages = [
      [{ peerId: 'c'.repeat(32), grant: 'msg' }],
      [{ peerId: PEER, grant: 'all' }],
    ];
    inbound = [envelope('e1', 'target: tmux:agent\n\nhi')];
    const r = relay({});
    await r.start(() => undefined);
    await until(() => settled.length === 1);
    expect(settled[0]).toMatchObject({ op: 'msg.ack', envelopeId: 'e1' });
    r.stop();
  });

  it('refuses a message over the size cap rather than typing part of it', async () => {
    inbound = [envelope('e1', `target: tmux:agent\n\n${'x'.repeat(40_000)}`)];
    let typed = 0;
    const r = relay({ deliver: () => (typed++, true) });
    await r.start(() => undefined);
    await until(() => settled.length === 1);
    expect(settled[0]).toMatchObject({ op: 'msg.defer' });
    expect(String(settled[0].reason)).toMatch(/larger than/);
    expect(typed).toBe(0);
    r.stop();
  });
});
