import { afterEach, beforeEach, expect, it } from 'vitest';
import { AttachStream, type StreamEnd } from './attach.js';
import { FakeDaemon, type FakeAttach } from './test-support/fake-daemon.js';
import { until } from './test-support/until.js';
import { FRAME } from './wire.js';

let daemon: FakeDaemon;
beforeEach(async () => {
  daemon = await FakeDaemon.start();
});
afterEach(async () => {
  await daemon.close();
});

it('drops input after a detach, which ends the stream as the daemon says', async () => {
  let attach: FakeAttach | undefined;
  daemon.onAttach((a) => {
    attach = a;
    a.onFrame((f) => {
      if (f.type === FRAME.close) {
        a.sendJson(FRAME.close, { reason: 'detached' });
      }
    });
  });
  const stream = await AttachStream.open(daemon.socketPath, 's1');
  const ends: StreamEnd[] = [];
  stream.onEnd((end) => ends.push(end));
  await until(() => attach !== undefined);

  stream.close();
  stream.sendData(Buffer.from('late'));
  await until(() => ends.length === 1);
  expect(ends[0].reason).toBe('detached');
  expect(attach!.frames.map((f) => f.type)).toEqual([FRAME.close]);
});
