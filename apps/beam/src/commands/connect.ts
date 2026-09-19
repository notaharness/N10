/**
 * `beam connect <peer> [pty|pty:<program>] [--transport ws|webrtc] [-- argv...]`
 * (D9): stdin/stdout into a pty stream on that machine.
 */

import { parseArgs } from '../args.js';
import { dialPeer } from '../dial-peer.js';
import type { Io } from '../io.js';
import { buildEphemeral } from '../node.js';
import { resolvePeer } from '../peer-resolve.js';
import { RuntimeError, UsageError } from '../usage.js';

interface RawModeCapable {
  setRawMode(mode: boolean): unknown;
  isTTY?: boolean;
}

function asRawModeCapable(stdin: unknown): RawModeCapable | null {
  const candidate = stdin as Partial<RawModeCapable>;
  return typeof candidate.setRawMode === 'function'
    ? (candidate as RawModeCapable)
    : null;
}

function requireWsTransport(transport: string): void {
  if (transport !== 'ws') {
    throw new RuntimeError(
      `--transport ${transport} is not implemented yet — only "ws" is available today`
    );
  }
}

function streamNameFor(streamArg: string | undefined): string {
  return streamArg && streamArg.startsWith('pty') ? streamArg : 'pty';
}

/** A terminating signal ends the process without unwinding the stack, so
 * `withRawStdin`'s `finally` never runs for one. 128 + the signal number is
 * what a shell reports for a process the signal actually killed. */
const RAW_MODE_SIGNALS: Record<string, number> = {
  SIGTERM: 143,
  SIGHUP: 129,
};

export interface RawStdinOptions {
  /** Ends the process once raw mode has been restored. Injected so a test
   * can drive the signal path without killing the test runner. */
  exit?: (code: number) => void;
}

/** Enter raw mode for the duration of `body()` when stdin is a real TTY,
 * always restoring it afterward — split out so `runConnect` itself reads as
 * "dial, stream, tear down" without the terminal-mode bookkeeping inline.
 *
 * SIGTERM and SIGHUP (the terminal window closing) would otherwise end the
 * process with the user's shell still in raw mode, so they restore it
 * first. Deliberately not SIGINT: `setRawMode(true)` turns off ISIG, which
 * is what makes Ctrl-C arrive as a plain 0x03 byte for forwarding to the
 * remote pty. Handling SIGINT here would intercept the one key this
 * command exists to pass through. */
export async function withRawStdin<T>(
  stdin: unknown,
  body: () => Promise<T>,
  options: RawStdinOptions = {}
): Promise<T> {
  const raw = asRawModeCapable(stdin);
  if (raw?.isTTY !== true) return body();
  const exit = options.exit ?? ((code: number) => process.exit(code));

  raw.setRawMode(true);
  const restoreAndExit = (signal: string): void => {
    raw.setRawMode(false);
    exit(RAW_MODE_SIGNALS[signal] ?? 1);
  };
  const handlers = Object.keys(RAW_MODE_SIGNALS).map(
    (signal) => [signal, () => restoreAndExit(signal)] as const
  );
  for (const [signal, handler] of handlers) process.once(signal, handler);

  try {
    return await body();
  } finally {
    for (const [signal, handler] of handlers)
      process.removeListener(signal, handler);
    raw.setRawMode(false);
  }
}

export async function runConnect(args: string[], io: Io): Promise<number> {
  const parsed = parseArgs(args, { valueFlags: ['transport'] });
  const [nameOrId, streamArg] = parsed.positionals;
  if (!nameOrId) {
    throw new UsageError(
      'usage: beam connect <peer> [pty|pty:<program>] [--transport ws|webrtc] [-- argv...]'
    );
  }
  requireWsTransport(parsed.values.get('transport') ?? 'ws');

  const ctx = buildEphemeral(io);
  const peer = resolvePeer(ctx.peers, nameOrId);
  const connection = await dialPeer(ctx, peer);

  const openParams: Record<string, unknown> = {};
  if (parsed.rest.length > 0) openParams['argv'] = parsed.rest;
  const stream = await connection.openStream(
    streamNameFor(streamArg),
    openParams
  );

  const exitCode = await withRawStdin(io.stdin, async () => {
    const onStdinData = (chunk: Buffer | string): void => {
      stream.write(
        typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk
      );
    };
    io.stdin.on('data', onStdinData);
    stream.onData((data) => io.stdout.write(Buffer.from(data)));
    try {
      return await new Promise<number>((resolve) =>
        stream.onClose(() => resolve(0))
      );
    } finally {
      io.stdin.removeListener?.(
        'data',
        onStdinData as (...a: unknown[]) => void
      );
    }
  });

  connection.close();
  return exitCode;
}
