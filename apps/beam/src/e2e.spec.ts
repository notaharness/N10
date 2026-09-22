/**
 * One real end-to-end test: two nodes in a single process, driven through
 * `run()`, nothing built and nothing spawned. A serves; B pairs; B execs a
 * command on A; A messages B while B is disconnected; B reconnects (a
 * one-shot `msg listen`, which dials out itself since B runs no node of
 * its own) and receives it exactly once.
 *
 * B's endpoint for A is set directly through the peer table after pairing
 * (`PeerTable.setEndpoints`) rather than left to `serve`'s own endpoint
 * advertising: `serve` deliberately never advertises a loopback address
 * (real remote peers could never dial it), but this test runs both
 * "machines" as loopback in one process, so it has to say explicitly what
 * a real deployment's non-loopback bind would otherwise say implicitly.
 */
import { rmSync } from 'node:fs';
import { PeerTable, loadOrCreateIdentity } from '@n10/beam';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { run } from './run.js';
import {
  makeFakeIo,
  makeFakeIoWithBeamDir,
  waitFor,
  type FakeIo,
} from './test-support/fake-io.js';

let aIo: FakeIo;
let aDir: string;
let aController: AbortController;
let bDir: string;

beforeEach(() => {
  ({ io: aIo, beamDir: aDir } = makeFakeIoWithBeamDir('beam-e2e-a-'));
  ({ beamDir: bDir } = makeFakeIoWithBeamDir('beam-e2e-b-'));
  aController = new AbortController();
  aIo.signal = aController.signal;
});

afterEach(async () => {
  const closed = new Promise<void>((resolve) => {
    aIo.exit = () => resolve();
  });
  aController.abort();
  await closed;
  rmSync(aDir, { recursive: true, force: true });
  rmSync(bDir, { recursive: true, force: true });
});

async function waitUntilNotConnected(
  env: Record<string, string | undefined>,
  peerId: string
): Promise<void> {
  await waitFor(
    async () => {
      const probe = makeFakeIo(env);
      await run(['peers', '--json'], probe);
      const rows = JSON.parse(probe.stdoutText()) as {
        peerId: string;
        state: string;
      }[];
      return rows.find((r) => r.peerId === peerId)?.state;
    },
    (state) => state !== 'connected'
  );
}

describe('beam CLI end to end: serve, pair, exec, disconnected send, reconnect', () => {
  it(
    'carries B through the whole flow against A, entirely through run()',
    { timeout: 20_000 },
    async () => {
      const serveCode = await run(
        ['serve', '--port', '0', '--label', 'workbox'],
        aIo
      );
      expect(serveCode).toBe(0);
      const bound = aIo.stdoutText().match(/bound to (http:\/\/[^\s]+)/);
      const pairUrl = aIo
        .stdoutText()
        .match(/(http:\/\/\S+\/pair#token=\S+)/)?.[1];
      expect(bound?.[1]).toBeDefined();
      expect(pairUrl).toBeDefined();
      // Printed last, per the brief and docs/beam.md — the pairing URL is
      // the last non-empty line of output.
      const lines = aIo.stdoutLines();
      expect(lines[lines.length - 1]).toBe(pairUrl);

      const bEnv = { BEAM_CONFIG_DIR: bDir };
      const bIo = makeFakeIo(bEnv);
      const pairCode = await run(['pair', pairUrl as string], bIo);
      expect(pairCode).toBe(0);
      expect(bIo.stdoutText()).toContain('paired with "workbox"');

      const aPeerId = new PeerTable(bDir).list()[0]?.peerId;
      expect(aPeerId).toBeDefined();
      new PeerTable(bDir).setEndpoints(aPeerId as string, [
        bound?.[1] as string,
      ]);
      const bPeerId = loadOrCreateIdentity(bDir).peerId;

      // B execs a command on A.
      const execIo = makeFakeIo(bEnv);
      const execCode = await run(
        ['exec', aPeerId as string, '--', 'sh', '-c', 'echo hello-from-A'],
        execIo
      );
      expect(execCode).toBe(0);
      expect(execIo.stdoutText()).toContain('hello-from-A');

      // Let A finish tearing down B's exec connection before sending, so the
      // send below is unambiguously "queued", not a race against a
      // still-closing connection.
      await waitUntilNotConnected(aIo.env, bPeerId);

      // A messages B while B is not connected: queued, exit 0, and the
      // durable-success wording.
      const sendIo = makeFakeIo(aIo.env);
      const sendCode = await run(
        [
          'msg',
          'send',
          bPeerId,
          '--topic',
          'orchestra',
          '--message',
          'orchestra-report',
        ],
        sendIo
      );
      expect(sendCode).toBe(0);
      expect(sendIo.stdoutText()).toMatch(/queued for .*not connected/s);
      expect(sendIo.stdoutText()).toMatch(/do not send it again/i);

      // B reconnects — a one-shot `msg listen` against A, and receives the
      // message that was waiting, exactly once.
      const listenIo = makeFakeIo(bEnv);
      const listenController = new AbortController();
      listenIo.signal = listenController.signal;
      const listenPromise = run(['msg', 'listen', aPeerId as string], listenIo);

      await waitFor(
        () => listenIo.stdoutText(),
        (text) => text.includes('orchestra-report')
      );
      listenController.abort();
      expect(await listenPromise).toBe(0);

      const received = listenIo
        .stdoutLines()
        .map((line) => JSON.parse(line) as { payload: string });
      expect(
        received.filter((e) => e.payload === 'orchestra-report')
      ).toHaveLength(1);
    }
  );
});
