import { describe, expect, it } from 'vitest';
import { ptyExitCode, runConnect, withRawStdin } from './connect.js';
import {
  makeFakeIo,
  makeFakeIoWithBeamDir,
  type FakeIo,
} from '../test-support/fake-io.js';
import { RuntimeError, USAGE } from '../usage.js';

interface FakeRawStdin {
  isTTY?: boolean;
  setRawMode(mode: boolean): void;
  modes: boolean[];
}

function fakeStdin(isTTY: boolean): FakeRawStdin {
  const modes: boolean[] = [];
  return {
    isTTY,
    modes,
    setRawMode(mode: boolean) {
      modes.push(mode);
    },
  };
}

/** The listeners `withRawStdin` added for `signal`, taken by difference so
 * the test never touches vitest's own signal handling — and invoked
 * directly rather than through `process.emit`, which would run those too. */
function listenersAddedBy(
  signal: NodeJS.Signals,
  before: number
): ((signal: string) => void)[] {
  return process.listeners(signal).slice(before) as ((
    signal: string
  ) => void)[];
}

describe('withRawStdin', () => {
  it('restores raw mode before ending on SIGTERM, which never unwinds the stack', async () => {
    const stdin = fakeStdin(true);
    const exits: number[] = [];
    const beforeTerm = process.listenerCount('SIGTERM');
    const beforeInt = process.listenerCount('SIGINT');

    let finish: () => void = () => undefined;
    const running = withRawStdin(
      stdin,
      () => new Promise<number>((resolve) => (finish = () => resolve(0))),
      {
        exit: (code) => {
          exits.push(code);
          finish();
        },
      }
    );

    const added = listenersAddedBy('SIGTERM', beforeTerm);
    expect(added).toHaveLength(1);
    // Ctrl-C must keep reaching the remote pty as 0x03 — raw mode turns off
    // ISIG precisely so it does — so this command must claim no SIGINT.
    expect(process.listenerCount('SIGINT')).toBe(beforeInt);

    (added[0] as (signal: string) => void)('SIGTERM');
    await running;

    expect(stdin.modes[0]).toBe(true);
    expect(stdin.modes[1]).toBe(false); // restored *before* the exit
    expect(exits).toEqual([143]);
  });

  it('ends with 129 on SIGHUP, the terminal window closing', async () => {
    const stdin = fakeStdin(true);
    const exits: number[] = [];
    const before = process.listenerCount('SIGHUP');

    let finish: () => void = () => undefined;
    const running = withRawStdin(
      stdin,
      () => new Promise<number>((resolve) => (finish = () => resolve(0))),
      {
        exit: (code) => {
          exits.push(code);
          finish();
        },
      }
    );

    const added = listenersAddedBy('SIGHUP', before);
    expect(added).toHaveLength(1);
    (added[0] as (signal: string) => void)('SIGHUP');
    await running;

    expect(stdin.modes).toContain(false);
    expect(exits).toEqual([129]);
  });

  it('leaves no signal handlers behind once the stream settles normally', async () => {
    const stdin = fakeStdin(true);
    const before = {
      term: process.listenerCount('SIGTERM'),
      hup: process.listenerCount('SIGHUP'),
    };

    const code = await withRawStdin(stdin, () => Promise.resolve(7));

    expect(code).toBe(7);
    expect(stdin.modes).toEqual([true, false]);
    expect(process.listenerCount('SIGTERM')).toBe(before.term);
    expect(process.listenerCount('SIGHUP')).toBe(before.hup);
  });

  it('touches neither raw mode nor signals when stdin is not a TTY', async () => {
    const stdin = fakeStdin(false);
    const before = process.listenerCount('SIGTERM');

    const code = await withRawStdin(stdin, () => Promise.resolve(0));

    expect(code).toBe(0);
    expect(stdin.modes).toEqual([]);
    expect(process.listenerCount('SIGTERM')).toBe(before);
  });
});

/** The help text is a promise about what you may type, so `--transport`
 * lists only values `connect` accepts: anything else hands the user a
 * value the command turns around and refuses. The WebRTC transport is a
 * seam (docs/beam.md, "Deliberately out of scope"), and a seam belongs in
 * the design notes rather than in the help. Whoever implements it makes
 * these two tests agree again by making the flag work. */
describe('connect transports', () => {
  const advertised = (text: string): string[] => {
    const match = text.match(/--transport ([a-z|]+)/);
    return match ? match[1].split('|') : [];
  };

  it('advertises exactly the transports the command implements', () => {
    expect(advertised(USAGE)).toEqual(['ws']);
  });

  it('refuses an unimplemented transport as unimplemented, not as a usage error', async () => {
    const { io } = makeFakeIoWithBeamDir();

    // Rejected on the transport alone: `worker` is not in this empty peer
    // table, so a run that got as far as resolving the peer would fail with
    // a different message and this assertion would catch the difference.
    const rejection = runConnect(['worker', '--transport', 'webrtc'], io);

    await expect(rejection).rejects.toBeInstanceOf(RuntimeError);
    await expect(rejection).rejects.toThrow(
      /--transport webrtc is not implemented/
    );
  });
});

describe('ptyExitCode', () => {
  function io(): { io: FakeIo; stderr: () => string } {
    const fake = makeFakeIo({});
    return { io: fake, stderr: () => fake.stderrText() };
  }

  it('a clean remote exit is success, whatever the remote code was', () => {
    // `connect`'s documented contract is 0 success / 1 runtime failure / 2
    // usage — `exec` is the one command that hands back a remote code, and
    // that is a documented exception rather than the rule.
    for (const reason of [
      'process exited (code 0)',
      'process exited (code 3)',
    ]) {
      const { io: fake, stderr } = io();
      expect(ptyExitCode(reason, fake)).toBe(0);
      expect(stderr()).toBe('');
    }
  });

  it('every way the stream can end that is not the process ending is a failure, and is reported', () => {
    // The reasons the muxer, the connection and the open gate actually
    // write. Each used to come back as 0, telling a script the shell ran
    // to completion.
    for (const reason of [
      undefined,
      'connection closed',
      'connection closed: truncated frame',
      'closed locally',
      'stream handler failed: boom',
      'scope-not-granted:pty',
      'too many live pty sessions',
    ]) {
      const { io: fake, stderr } = io();
      expect(ptyExitCode(reason, fake)).toBe(1);
      expect(stderr()).toContain('connection to the remote terminal ended');
    }
  });

  it('a process killed by a signal is a failure too, and names the signal', () => {
    const { io: fake, stderr } = io();
    expect(ptyExitCode('process exited (code 0, signal 15)', fake)).toBe(1);
    expect(stderr()).toContain('signal 15');
  });
});
