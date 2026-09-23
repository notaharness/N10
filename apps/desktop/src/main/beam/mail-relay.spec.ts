import type { LocalDeliveryTarget } from '@n10/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MailRelay, type Envelope } from './mail-relay.js';
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
beforeEach(async () => {
  daemon = await FakeDaemon.start();
  inbound = [];
  settled = [];
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
}): MailRelay {
  return new MailRelay({
    socketPath: daemon.socketPath,
    resolveTarget:
      opts.resolve ?? (() => ({ kind: 'agent', key: 'key-of-target' })),
    deliver: opts.deliver ?? (() => true),
    retryMs: opts.retryMs ?? 60_000,
    now: () => 1000,
    onChange: opts.onChange,
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

  it('dismissing a refusal acks it on the next offer without typing it', async () => {
    inbound = [envelope('e1', 'target: tmux:x\n\nhi')];
    let typed = 0;
    const r = relay({
      resolve: () => ({ kind: 'refused', reason: 'shell terminal' }),
      deliver: () => (typed++, true),
    });
    await r.start(() => undefined);
    // Listed once deferred: only a listed refusal can be dismissed.
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
