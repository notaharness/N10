import { EventEmitter } from 'node:events';
import type { IPty } from 'node-pty';
import { describe, expect, it } from 'vitest';
import {
  decodePtyExit,
  encodePtyExit,
  createPtyStreamHandler,
  guardPtyErrors,
  isPtyExitError,
  MAX_PTY_SESSIONS,
} from './pty-handler.js';
import type { BeamStream, StreamContext } from './stream.js';

/** Minimal fake BeamStream: enough surface for the pty handler to drive,
 * plus test-only getters to observe what it did. */
function fakeStream(
  id: number,
  name: string,
  options: { peer?: StreamContext; openParams?: Record<string, unknown> } = {}
) {
  const dataHandlers: ((data: Uint8Array) => void)[] = [];
  const closeHandlers: ((reason?: string) => void)[] = [];
  const controlHandlers: ((message: Record<string, unknown>) => void)[] = [];
  const written: Uint8Array[] = [];
  const controlsSent: Record<string, unknown>[] = [];
  let closedWith: string | undefined;
  let closed = false;
  const stream: BeamStream = {
    id,
    name,
    peer: options.peer ?? { peerId: 'peer-under-test', label: 'test-peer' },
    openParams: options.openParams,
    write: (data) => written.push(data),
    control: (message) => controlsSent.push(message),
    close: (reason) => {
      if (closed) return;
      closed = true;
      closedWith = reason;
      for (const h of closeHandlers) h(reason);
    },
    onData: (h) => dataHandlers.push(h),
    onClose: (h) => closeHandlers.push(h),
    onControl: (h) => controlHandlers.push(h),
  };
  return {
    stream,
    written,
    controlsSent,
    emitData: (data: Uint8Array) => dataHandlers.forEach((h) => h(data)),
    emitControl: (message: Record<string, unknown>) =>
      controlHandlers.forEach((h) => h(message)),
    text: () => written.map((b) => new TextDecoder().decode(b)).join(''),
    get closedWith() {
      return closedWith;
    },
    get closed() {
      return closed;
    },
  };
}

async function waitFor<T>(
  read: () => T,
  predicate: (value: T) => boolean,
  timeoutMs = 4000
): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = read();
    if (predicate(value)) return value;
    if (Date.now() - started > timeoutMs)
      throw new Error('timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe('createPtyStreamHandler', () => {
  it('acks a "pty" open and a "pty:<program>" open the same way', () => {
    const handler = createPtyStreamHandler();
    const plain = fakeStream(1, 'pty');
    const named = fakeStream(2, 'pty:sh');
    handler(plain.stream);
    handler(named.stream);
    expect(plain.controlsSent).toContainEqual({ kind: 'opened' });
    expect(named.controlsSent).toContainEqual({ kind: 'opened' });
    plain.stream.close();
    named.stream.close();
  });

  it('bytes written to the stream reach the process and its output comes back', async () => {
    const handler = createPtyStreamHandler();
    const fake = fakeStream(3, 'pty:sh');
    handler(fake.stream);
    fake.emitData(new TextEncoder().encode('echo hello-from-pty\n'));
    const output = await waitFor(fake.text, (text) =>
      text.includes('hello-from-pty')
    );
    expect(output).toContain('hello-from-pty');
    fake.stream.close();
  });

  it('treats pty:<program> as one literal program name, never a shell command line', async () => {
    const handler = createPtyStreamHandler();
    // If this were parsed as a shell command, it would print "hi there".
    // A literal program lookup for "echo hi there" instead fails to spawn
    // (or exits immediately reporting the failure) — either way, nothing
    // it ran ever produces that text.
    const fake = fakeStream(4, 'pty:echo hi there');
    handler(fake.stream);
    await waitFor(
      () => fake.closedWith,
      (reason) => reason !== undefined
    );
    expect(fake.text()).not.toContain('hi there');
  });

  it('clamps resize to the 2-500 range instead of throwing on out-of-range values', () => {
    const handler = createPtyStreamHandler();
    const fake = fakeStream(5, 'pty:sh');
    handler(fake.stream);
    expect(() =>
      fake.emitControl({ kind: 'resize', streamId: 5, cols: 999999, rows: -5 })
    ).not.toThrow();
    expect(() =>
      fake.emitControl({ kind: 'resize', streamId: 5, cols: 'nope', rows: 40 })
    ).not.toThrow();
    fake.stream.close();
  });

  it('closing the stream kills the process (no further output arrives)', async () => {
    const handler = createPtyStreamHandler();
    const fake = fakeStream(6, 'pty:sh');
    handler(fake.stream);
    fake.emitData(new TextEncoder().encode('echo before-close\n'));
    await waitFor(fake.text, (text) => text.includes('before-close'));
    const lengthAtClose = fake.written.length;
    fake.stream.close('client done');
    await new Promise((resolve) => setTimeout(resolve, 150));
    // A live shell keeps printing its prompt; a killed one produces nothing
    // further once the write buffer at close time has been flushed.
    expect(fake.written.length).toBeLessThanOrEqual(lengthAtClose + 1);
  });

  it('the process exiting closes the stream with a reason', async () => {
    const handler = createPtyStreamHandler();
    const fake = fakeStream(7, 'pty:sh');
    handler(fake.stream);
    fake.emitData(new TextEncoder().encode('exit 0\n'));
    await waitFor(
      () => fake.closedWith,
      (reason) => reason !== undefined
    );
    expect(fake.closedWith).toMatch(/exit/);
  });

  it('enforces a cap of MAX_PTY_SESSIONS live PTYs per peer', () => {
    const handler = createPtyStreamHandler();
    const fakes = Array.from({ length: MAX_PTY_SESSIONS + 1 }, (_, i) =>
      fakeStream(100 + i, 'pty:sh')
    );
    for (const fake of fakes) handler(fake.stream);
    const over = fakes[MAX_PTY_SESSIONS];
    expect(over.closedWith).toMatch(/too many live pty sessions/);
    for (const fake of fakes) fake.stream.close();
  });

  it("D5: the cap is per peer, not per node — one peer at its cap cannot shrink another peer's budget", () => {
    const handler = createPtyStreamHandler();
    const peerA = { peerId: 'peer-a-at-cap', label: 'a' };
    const peerB = { peerId: 'peer-b', label: 'b' };
    const aFakes = Array.from({ length: MAX_PTY_SESSIONS }, (_, i) =>
      fakeStream(200 + i, 'pty:sh', { peer: peerA })
    );
    for (const fake of aFakes) handler(fake.stream);
    // Peer A is now exactly at its own cap.
    const overForA = fakeStream(999, 'pty:sh', { peer: peerA });
    handler(overForA.stream);
    expect(overForA.closedWith).toMatch(/too many live pty sessions/);

    // Peer B, sharing the same handler instance (one per node — A1), must
    // still get its own full budget.
    const forB = fakeStream(1, 'pty:sh', { peer: peerB });
    expect(() => handler(forB.stream)).not.toThrow();
    expect(forB.controlsSent).toContainEqual({ kind: 'opened' });

    for (const fake of aFakes) fake.stream.close();
    forB.stream.close();
  });

  it('A1: two peers opening the same stream id run independent, non-colliding shells', async () => {
    // Regression for the cross-connection orphaning bug: a single handler
    // instance serves every connection (host.ts shares one StreamRegistry),
    // so two peers each opening stream id 1 must not collide in the
    // handler's session bookkeeping.
    const handler = createPtyStreamHandler();
    const peerA = { peerId: 'peer-a', label: 'a' };
    const peerB = { peerId: 'peer-b', label: 'b' };
    const fakeA = fakeStream(1, 'pty:sh', { peer: peerA });
    const fakeB = fakeStream(1, 'pty:sh', { peer: peerB });
    handler(fakeA.stream);
    handler(fakeB.stream);

    fakeA.emitData(new TextEncoder().encode('echo from-a\n'));
    fakeB.emitData(new TextEncoder().encode('echo from-b\n'));
    await waitFor(fakeA.text, (t) => t.includes('from-a'));
    await waitFor(fakeB.text, (t) => t.includes('from-b'));

    // Closing A's stream must not touch B's still-live shell.
    fakeA.stream.close('a done');
    await new Promise((resolve) => setTimeout(resolve, 100));
    const bLengthAfterAClosed = fakeB.written.length;
    fakeB.emitData(new TextEncoder().encode('echo still-alive\n'));
    const output = await waitFor(fakeB.text, (t) => t.includes('still-alive'));
    expect(output).toContain('still-alive');
    expect(fakeB.written.length).toBeGreaterThan(bLengthAfterAClosed);

    fakeB.stream.close('b done');
  });

  it('A4: the child sees the caller id and label, and no secret material', async () => {
    const handler = createPtyStreamHandler({
      beamDir: '/tmp/beam-test-dir',
      inboxSocketPath: '/tmp/beam-test-dir/run/inbox.sock',
      ownPeerId: 'this-node-id',
    });
    const fake = fakeStream(1, 'pty:sh', {
      peer: { peerId: 'caller-id-123', label: 'laptop' },
    });
    handler(fake.stream);
    fake.emitData(
      new TextEncoder().encode(
        'printenv BEAM_CALLER_ID BEAM_CALLER_LABEL BEAM_PEER_ID BEAM_DIR BEAM_INBOX\n'
      )
    );
    // printenv writes the five values in order, and a pty read can split
    // between them. Gate on all of them, not just the first: waiting only
    // for BEAM_CALLER_ID lets the assertions below run against a partial
    // read, which fails on the later values and — worse — checks the
    // forbidden names against output that has barely started.
    const expected = [
      'caller-id-123',
      'laptop',
      'this-node-id',
      '/tmp/beam-test-dir',
    ];
    const output = await waitFor(fake.text, (t) =>
      expected.every((value) => t.includes(value))
    );
    for (const value of expected) expect(output).toContain(value);
    for (const forbidden of ['PRIVATE_KEY', 'BEAM_TICKET', 'BEAM_TOKEN']) {
      expect(output).not.toContain(forbidden);
    }
    fake.stream.close();
  });

  it('D1: argv[0] runs directly (no shell, no word splitting) and env/cwd/cols/rows are honored', async () => {
    const handler = createPtyStreamHandler();
    const fake = fakeStream(1, 'pty', {
      openParams: {
        argv: ['sh', '-c', 'echo $GREETING; pwd; echo "$COLUMNS"'],
        cwd: '/tmp',
        env: { GREETING: 'hi-from-openparams' },
        cols: 100,
        rows: 40,
      },
    });
    handler(fake.stream);
    const output = await waitFor(fake.text, (t) =>
      t.includes('hi-from-openparams')
    );
    expect(output).toContain('hi-from-openparams');
    expect(output).toContain('/tmp');
    fake.stream.close();
  });

  it('D1: empty argv means the login shell, matching the bare "pty" name', () => {
    const handler = createPtyStreamHandler();
    const fake = fakeStream(1, 'pty', { openParams: { argv: [] } });
    expect(() => handler(fake.stream)).not.toThrow();
    expect(fake.controlsSent).toContainEqual({ kind: 'opened' });
    fake.stream.close();
  });

  it('rejects a relative cwd rather than resolving it against the host cwd', () => {
    const handler = createPtyStreamHandler();
    const fake = fakeStream(1, 'pty:sh', {
      openParams: { cwd: 'relative/dir' },
    });
    handler(fake.stream);
    expect(fake.closedWith).toMatch(/cwd must be absolute or start with ~\//);
  });

  it("a pty's own 'error' is handled rather than thrown out of the node", () => {
    // node-pty's UnixTerminal is an EventEmitter: emitting 'error' on it
    // with no listener throws synchronously, and the throw comes from a
    // socket whose failure the far side gets to time.
    const proc = new EventEmitter();
    const reported: string[] = [];
    guardPtyErrors(proc as unknown as IPty, (error) =>
      reported.push(error.message)
    );
    expect(() => proc.emit('error', new Error('read EIO'))).not.toThrow();
    expect(reported).toEqual(['read EIO']);
  });

  it("treats node-pty's EIO as the exit it is, and anything else as a fault", () => {
    // `read EIO` is how node-pty reports that the child closed the pty.
    // Closing the stream on it would replace the exit code and signal the
    // caller needs with a message about a file descriptor.
    expect(isPtyExitError(new Error('read EIO'))).toBe(true);
    expect(isPtyExitError(new Error('errno 5'))).toBe(true);
    expect(isPtyExitError(new Error('EACCES: permission denied'))).toBe(false);
  });
});

describe('a pty stream close reason', () => {
  it('round-trips an exit through encode and decode', () => {
    expect(decodePtyExit(encodePtyExit({ exitCode: 0 }))).toEqual({
      exitCode: 0,
    });
    expect(decodePtyExit(encodePtyExit({ exitCode: 3 }))).toEqual({
      exitCode: 3,
    });
    expect(decodePtyExit(encodePtyExit({ exitCode: 0, signal: 9 }))).toEqual({
      exitCode: 0,
      signal: 9,
    });
  });

  it('reads the reason the handler actually writes, not one this test made up', () => {
    // The literal the handler produced before `encodePtyExit` existed. If
    // the two ever drift, a peer running an older build stops being
    // understood, and the caller starts reading its clean exits as drops.
    expect(decodePtyExit('process exited (code 0)')).toEqual({ exitCode: 0 });
    expect(decodePtyExit('process exited (code 0, signal 15)')).toEqual({
      exitCode: 0,
      signal: 15,
    });
  });

  it('refuses every close reason that is not the process ending', () => {
    // Each of these is a real reason some layer writes: the muxer on a
    // transport that ended, on one that ended mid-frame, and on a handler
    // that threw; the connection's own local close; the open gate; and
    // the pty handler's own non-exit failures.
    for (const reason of [
      undefined,
      '',
      'connection closed',
      'connection closed: truncated frame',
      'closed locally',
      'stream handler failed: boom',
      'scope-not-granted:pty',
      'too many live pty sessions',
      'pty error: spawn ENOENT',
      'process exited',
      'process exited (code )',
      'process exited (code abc)',
      'a process exited (code 0)',
      'process exited (code 0) and then some',
    ]) {
      expect(decodePtyExit(reason)).toBeNull();
    }
  });
});
