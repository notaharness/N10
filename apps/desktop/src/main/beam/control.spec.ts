import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BeamOpError, ControlConnection } from './control.js';
import { FakeDaemon, FakeOpError } from './test-support/fake-daemon.js';

let daemon: FakeDaemon;
beforeEach(async () => {
  daemon = await FakeDaemon.start();
});
afterEach(async () => {
  await daemon.close();
});

describe('ControlConnection', () => {
  it('sends a flat request and resolves with its result', async () => {
    daemon.on('peer.alias', (req) => ({ echoed: req.alias }));
    const conn = await ControlConnection.connect(daemon.socketPath);
    await expect(
      conn.request('peer.alias', { peer: 'abc', alias: 'box' })
    ).resolves.toEqual({ echoed: 'box' });
    expect(daemon.requests('peer.alias')[0]).toMatchObject({
      op: 'peer.alias',
      peer: 'abc',
      alias: 'box',
    });
    conn.close();
  });

  it('matches replies that arrive out of order to their requests', async () => {
    let releaseSlow: (v: unknown) => void = () => undefined;
    daemon.on('slow', () => new Promise((r) => (releaseSlow = r)));
    daemon.on('fast', () => ({ which: 'fast' }));
    const conn = await ControlConnection.connect(daemon.socketPath);
    const slow = conn.request('slow');
    await expect(conn.request('fast')).resolves.toEqual({ which: 'fast' });
    releaseSlow({ which: 'slow' });
    await expect(slow).resolves.toEqual({ which: 'slow' });
    conn.close();
  });

  it('rejects with the daemon error token and detail', async () => {
    daemon.on('peer.resolve', () => {
      throw new FakeOpError('ambiguous-peer', 'aaaa, aaab');
    });
    const conn = await ControlConnection.connect(daemon.socketPath);
    const err = await conn.request('peer.resolve').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BeamOpError);
    expect(err).toMatchObject({ code: 'ambiguous-peer', detail: 'aaaa, aaab' });
    conn.close();
  });

  it('keeps delivering after a listener throws', async () => {
    const conn = await ControlConnection.connect(daemon.socketPath);
    await conn.request('events.subscribe');
    const seen: string[] = [];
    conn.onEvent(() => {
      throw new Error('listener bug');
    });
    conn.onEvent((event) => seen.push(event));
    const quiet = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    daemon.emit('peer', {});
    await expect(conn.request('status')).resolves.toEqual({});
    quiet.mockRestore();
    expect(seen).toEqual(['peer']);
    conn.close();
  });

  it('delivers events in order to every listener', async () => {
    const conn = await ControlConnection.connect(daemon.socketPath);
    await conn.request('events.subscribe');
    const seen: [string, unknown][] = [];
    conn.onEvent((event, data) => seen.push([event, data]));
    daemon.emit('peer', { peerId: 'a' });
    daemon.emit('peer.new', { peerId: 'b' });
    await conn.request('status');
    expect(seen).toEqual([
      ['peer', { peerId: 'a' }],
      ['peer.new', { peerId: 'b' }],
    ]);
    conn.close();
  });

  it('rejects what is pending and notifies once when the daemon goes away', async () => {
    daemon.on('msg.subscribe', (_req, control) => control.destroy());
    const conn = await ControlConnection.connect(daemon.socketPath);
    let closes = 0;
    conn.onClose(() => closes++);
    await expect(conn.request('msg.subscribe')).rejects.toThrow(/closed/);
    await expect(conn.request('status')).rejects.toThrow(/closed/);
    expect(closes).toBe(1);
  });

  it('fails to connect when no daemon listens', async () => {
    await expect(
      ControlConnection.connect(`${daemon.socketPath}.missing`)
    ).rejects.toThrow(/ENOENT/);
  });
});
