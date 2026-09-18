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

/** Enter raw mode for the duration of `body()` when stdin is a real TTY,
 * always restoring it afterward — split out so `runConnect` itself reads as
 * "dial, stream, tear down" without the terminal-mode bookkeeping inline. */
async function withRawStdin<T>(
  stdin: unknown,
  body: () => Promise<T>
): Promise<T> {
  const raw = asRawModeCapable(stdin);
  const wasTty = raw?.isTTY === true;
  if (wasTty) raw.setRawMode(true);
  try {
    return await body();
  } finally {
    if (wasTty) raw.setRawMode(false);
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
