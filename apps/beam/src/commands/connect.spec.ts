import { describe, expect, it } from 'vitest';
import { withRawStdin } from './connect.js';

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
