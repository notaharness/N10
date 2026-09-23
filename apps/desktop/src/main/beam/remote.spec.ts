import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { StreamEventPayload } from '../../host/services/remote-machines.js';
import { ControlConnection } from './control.js';
import { createRemoteMachinePort } from './remote.js';
import {
  FakeDaemon,
  FakeOpError,
  type FakeAttach,
} from './test-support/fake-daemon.js';
import { until } from './test-support/until.js';
import { FRAME } from './wire.js';

const PEER = 'b'.repeat(32);

let daemon: FakeDaemon;
let control: ControlConnection;
beforeEach(async () => {
  daemon = await FakeDaemon.start();
  control = await ControlConnection.connect(daemon.socketPath);
  let n = 0;
  daemon.on('exec.open', () => ({ streamId: `exec-${++n}` }));
  daemon.on('pty.open', () => ({ streamId: `pty-${++n}` }));
});
afterEach(async () => {
  control.close();
  await daemon.close();
});

function port() {
  return createRemoteMachinePort({
    request: (op, fields) => control.request(op, fields),
    socketPath: daemon.socketPath,
  });
}

const channel = (n: number, text: string) =>
  Buffer.concat([Buffer.from([n]), Buffer.from(text)]);

/** Answers each input frame `taken`, as the acceptor does. */
function acceptInput(attach: FakeAttach): void {
  attach.onFrame((f) => {
    if (f.type !== FRAME.close)
      attach.sendJson(FRAME.control, { kind: 'taken' });
  });
}

describe('execOn', () => {
  it('opens exec, sends stdin then EOF, and returns output and exit code', async () => {
    daemon.onAttach((attach) => {
      acceptInput(attach);
      attach.onFrame((f) => {
        if (f.type !== FRAME.control) return;
        if (
          (JSON.parse(f.payload.toString()) as { kind: string }).kind !==
          'stdin-eof'
        )
          return;
        attach.send(FRAME.data, channel(1, 'out '));
        attach.send(FRAME.data, channel(2, 'err'));
        attach.send(FRAME.data, channel(1, 'more'));
        attach.sendJson(FRAME.close, { reason: 'exit', exitCode: 3 });
      });
    });
    const result = await port().execOn(PEER, ['git', 'status'], {
      cwd: '/srv/repo',
      stdin: 'input',
    });
    expect(result).toEqual({ stdout: 'out more', stderr: 'err', code: 3 });
    expect(daemon.requests('exec.open')[0]).toMatchObject({
      peer: PEER,
      argv: ['git', 'status'],
      cwd: '/srv/repo',
    });
    const [attach] = daemon.attaches;
    expect(attach.streamId).toBe('exec-1');
    const data = attach.frames.filter((f) => f.type === FRAME.data);
    expect(data.map((f) => f.payload)).toEqual([channel(0, 'input')]);
    expect(attach.json(FRAME.control)).toEqual([{ kind: 'stdin-eof' }]);
  });

  it('rejects, naming the reason, when the stream ends without an exit', async () => {
    daemon.onAttach((attach) =>
      attach.sendJson(FRAME.close, { reason: 'offline', detail: 'no route' })
    );
    await expect(port().execOn(PEER, ['true'])).rejects.toThrow(
      /offline \(no route\)/
    );
  });

  it('rejects with the daemon error when the open is refused', async () => {
    daemon.on('exec.open', () => {
      throw new FakeOpError('revoked-peer', PEER);
    });
    await expect(port().execOn(PEER, ['true'])).rejects.toThrow(/revoked-peer/);
  });
});

describe('pty streams', () => {
  it('relays output as text, including a character split across frames', async () => {
    let attach!: FakeAttach;
    daemon.onAttach((a) => (attach = a));
    const p = port();
    const events: StreamEventPayload[] = [];
    p.onPtyEvent((e) => events.push(e));
    const { streamId } = await p.ptyOpen(PEER, {
      argv: ['tmux', 'attach'],
      cols: 1000,
      rows: 1,
    });
    expect(daemon.requests('pty.open')[0]).toMatchObject({
      peer: PEER,
      argv: ['tmux', 'attach'],
      cols: 500,
      rows: 2,
    });
    await until(() => attach !== undefined);
    const bytes = Buffer.from('é!');
    attach.send(FRAME.data, bytes.subarray(0, 1));
    attach.send(FRAME.data, bytes.subarray(1));
    attach.sendJson(FRAME.close, { reason: 'exit', exitCode: 0 });
    await until(() => events.some((e) => e.kind === 'closed'));
    expect(events).toEqual([
      { kind: 'data', streamId, data: 'é!' },
      { kind: 'closed', streamId },
    ]);
  });

  it('holds input beyond the four-frame window until the daemon answers taken', async () => {
    let attach!: FakeAttach;
    daemon.onAttach((a) => (attach = a));
    const p = port();
    const { streamId } = await p.ptyOpen(PEER, { cols: 80, rows: 24 });
    await until(() => attach !== undefined);
    for (const key of ['a', 'b', 'c', 'd', 'e']) p.ptyWrite(streamId, key);
    p.ptyResize(streamId, 120, 40);
    await until(() => attach.frames.length === 4);
    await new Promise((r) => setTimeout(r, 20));
    expect(attach.frames).toHaveLength(4);
    attach.sendJson(FRAME.control, { kind: 'taken' });
    attach.sendJson(FRAME.control, { kind: 'taken' });
    await until(() => attach.frames.length === 6);
    expect(attach.frames.map((f) => f.payload.toString())).toEqual([
      'a',
      'b',
      'c',
      'd',
      'e',
      '{"kind":"resize","cols":120,"rows":40}',
    ]);
  });

  it('detaches with a close frame and reports the stream closed', async () => {
    let attach!: FakeAttach;
    daemon.onAttach((a) => (attach = a));
    const p = port();
    const events: StreamEventPayload[] = [];
    p.onPtyEvent((e) => events.push(e));
    const { streamId } = await p.ptyOpen(PEER, { cols: 80, rows: 24 });
    await until(() => attach !== undefined);
    p.ptyClose(streamId);
    await until(() => events.length === 1);
    expect(attach.json(FRAME.close)).toEqual([{ reason: 'detached' }]);
    expect(events).toEqual([{ kind: 'closed', streamId }]);
  });

  it('reports the stream closed when the daemon drops the attach', async () => {
    let attach!: FakeAttach;
    daemon.onAttach((a) => (attach = a));
    const p = port();
    const events: StreamEventPayload[] = [];
    p.onPtyEvent((e) => events.push(e));
    const { streamId } = await p.ptyOpen(PEER, { cols: 80, rows: 24 });
    await until(() => attach !== undefined);
    attach.socket.destroy();
    await until(() => events.length === 1);
    expect(events).toEqual([{ kind: 'closed', streamId }]);
  });
});
