import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CeremonyProgress } from '../../host/contract-machines.js';
import { runCeremony as run } from './ceremony.js';
import { FakeDaemon, FakeOpError } from './test-support/fake-daemon.js';
import { until } from './test-support/until.js';

type Run = Parameters<typeof run>;
const runCeremony = (
  socketPath: Run[0],
  request: Run[1],
  onProgress: Run[2],
  signal = new AbortController().signal
) => run(socketPath, request, onProgress, signal);

const FLEET = 'f'.repeat(64);
const PEER = 'a'.repeat(32);

let daemon: FakeDaemon;
beforeEach(async () => {
  daemon = await FakeDaemon.start();
});
afterEach(async () => {
  await daemon.close();
});

describe('runCeremony', () => {
  it('runs init on one connection: create, then the signing ceremony and stages the wait announces', async () => {
    daemon.on('init.start', () => ({
      ceremonyUrl: 'https://beam.n10.is/#create',
    }));
    daemon.on('init.wait', (_req, conn) => {
      conn.emit('ceremony', { ceremonyUrl: 'https://beam.n10.is/#sign' });
      conn.emit('stage', { stage: 'publishing' });
      return { peerId: PEER, fleetId: FLEET, published: 'pending' };
    });
    const progress: CeremonyProgress[] = [];
    const outcome = await runCeremony(
      daemon.socketPath,
      { op: 'init', label: 'laptop', fleetName: 'home' },
      (p) => progress.push(p)
    );
    expect(outcome).toEqual({
      ok: true,
      op: 'init',
      fleetId: FLEET,
      peerId: PEER,
      published: false,
    });
    expect(progress).toEqual([
      { kind: 'stage', stage: 'preparing network' },
      {
        kind: 'passkey',
        step: 'create',
        ceremonyUrl: 'https://beam.n10.is/#create',
      },
      {
        kind: 'passkey',
        step: 'sign',
        ceremonyUrl: 'https://beam.n10.is/#sign',
      },
      { kind: 'stage', stage: 'publishing' },
    ]);
    expect(daemon.requests('init.start')[0]).toMatchObject({
      label: 'laptop',
      fleetName: 'home',
    });
    expect(daemon.controls).toHaveLength(1);
  });

  it('revokes the named peer and reports publication and acknowledgements', async () => {
    daemon.on('revoke.start', () => ({
      ceremonyUrl: 'https://beam.n10.is/#r',
    }));
    daemon.on('revoke.wait', () => ({
      local: true,
      published: true,
      acknowledgedBy: 2,
    }));
    const progress: CeremonyProgress[] = [];
    await expect(
      runCeremony(daemon.socketPath, { op: 'revoke', peerId: PEER }, (p) =>
        progress.push(p)
      )
    ).resolves.toEqual({
      ok: true,
      op: 'revoke',
      published: true,
      acknowledgedBy: 2,
    });
    expect(daemon.requests('revoke.start')[0]).toMatchObject({ peer: PEER });
    expect(progress[1]).toMatchObject({ kind: 'passkey', step: 'sign' });
  });

  it('resolves a refusal as its code and beam’s own detail, never a rejection', async () => {
    daemon.on('join.start', () => ({ ceremonyUrl: 'https://beam.n10.is/#j' }));
    daemon.on('join.wait', () => {
      throw new FakeOpError('prf-unsupported', 'no prf.results.first');
    });
    await expect(
      runCeremony(daemon.socketPath, { op: 'join', label: '' }, () => undefined)
    ).resolves.toEqual({
      ok: false,
      code: 'prf-unsupported',
      detail: 'no prf.results.first',
    });
  });

  it('names a connection that drops mid-wait as lost: the request may have completed', async () => {
    daemon.on('join.start', () => ({ ceremonyUrl: 'https://beam.n10.is/#j' }));
    daemon.on('join.wait', () => {
      for (const c of daemon.controls) c.destroy();
      return new Promise(() => undefined);
    });
    await expect(
      runCeremony(daemon.socketPath, { op: 'join', label: '' }, () => undefined)
    ).resolves.toEqual({ ok: false, code: 'connection-lost', detail: null });
  });

  it('resolves a missing daemon as a failure too', async () => {
    const outcome = await runCeremony(
      `${daemon.socketPath}.gone`,
      { op: 'join', label: '' },
      () => undefined
    );
    expect(outcome.ok).toBe(false);
  });

  it('sends a cancel made during the start once the start answers', async () => {
    let answerStart: (v: unknown) => void = () => undefined;
    let endWait: (err: Error) => void = () => undefined;
    daemon.on('join.start', () => new Promise((r) => (answerStart = r)));
    daemon.on(
      'join.wait',
      () => new Promise((_r, reject) => (endWait = reject))
    );
    daemon.on('ceremony.cancel', () => {
      endWait(new FakeOpError('ceremony-cancelled'));
      return {};
    });
    const abort = new AbortController();
    const outcome = runCeremony(
      daemon.socketPath,
      { op: 'join', label: 'box' },
      () => undefined,
      abort.signal
    );
    await until(() => daemon.requests('join.start').length === 1);
    abort.abort();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(daemon.requests('ceremony.cancel')).toHaveLength(0);
    answerStart({ ceremonyUrl: 'https://beam.n10.is/#sign' });
    await expect(outcome).resolves.toMatchObject({
      ok: false,
      code: 'ceremony-cancelled',
    });
  });

  it('cancels the flow it started while it waits', async () => {
    let endWait: (err: Error) => void = () => undefined;
    daemon.on('join.start', () => ({ ceremonyUrl: 'u' }));
    daemon.on(
      'join.wait',
      () => new Promise((_r, reject) => (endWait = reject))
    );
    daemon.on('ceremony.cancel', () => {
      endWait(new FakeOpError('ceremony-cancelled'));
      return {};
    });
    const abort = new AbortController();
    const outcome = runCeremony(
      daemon.socketPath,
      { op: 'join', label: 'box' },
      () => undefined,
      abort.signal
    );
    await until(() => daemon.requests('join.wait').length === 1);
    abort.abort();
    await expect(outcome).resolves.toMatchObject({
      code: 'ceremony-cancelled',
    });
  });
});
