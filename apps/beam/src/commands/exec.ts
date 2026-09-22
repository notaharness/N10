/**
 * `beam exec <peer> [--cwd PATH] [--env K=V]... -- argv...` (D9): run argv
 * on the peer, forward stdin, keep stdout/stderr separate, propagate the
 * remote exit code as this process's own.
 */

import {
  EXEC_CHANNEL_STDERR,
  EXEC_CHANNEL_STDIN,
  EXEC_CHANNEL_STDOUT,
  decodeExecExit,
  demuxExecData,
  prefixChannel,
} from '@n10/beam';
import { parseArgs } from '../args.js';
import { dialPeer } from '../dial-peer.js';
import type { Io } from '../io.js';
import { buildEphemeral } from '../node.js';
import { resolvePeer } from '../peer-resolve.js';
import { UsageError } from '../usage.js';

/** Route one demuxed exec-stream chunk to the right output, as raw bytes —
 * pulled out of `runExec` so the multibyte-boundary fix can be exercised
 * directly, without depending on a real child process happening to split
 * its output at the byte offset a test wants. */
export function writeChannelOutput(
  io: Io,
  channel: number,
  payload: Uint8Array
): void {
  if (channel === EXEC_CHANNEL_STDOUT) io.stdout.write(payload);
  else if (channel === EXEC_CHANNEL_STDERR) io.stderr.write(payload);
}

function parseEnvEntries(entries: string[]): Record<string, string> {
  const env: Record<string, string> = {};
  for (const entry of entries) {
    const eq = entry.indexOf('=');
    if (eq <= 0) {
      throw new UsageError(`--env expects KEY=VALUE, got: ${entry}`);
    }
    env[entry.slice(0, eq)] = entry.slice(eq + 1);
  }
  return env;
}

export async function runExec(args: string[], io: Io): Promise<number> {
  const parsed = parseArgs(args, { valueFlags: ['cwd'], multiFlags: ['env'] });
  const [nameOrId] = parsed.positionals;
  if (!nameOrId || parsed.rest.length === 0) {
    throw new UsageError(
      'usage: beam exec <peer> [--cwd PATH] [--env K=V]... -- argv...'
    );
  }

  const ctx = buildEphemeral(io);
  const peer = resolvePeer(ctx.peers, nameOrId);
  const connection = await dialPeer(ctx, peer);

  const stream = await connection.openStream('exec', {
    argv: parsed.rest,
    cwd: parsed.values.get('cwd'),
    env: parseEnvEntries(parsed.multi.get('env') ?? []),
  });

  const onStdinData = (chunk: Buffer | string): void => {
    const bytes =
      typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
    stream.write(prefixChannel(EXEC_CHANNEL_STDIN, bytes));
  };
  const onStdinEnd = (): void => stream.control({ kind: 'stdin-eof' });
  io.stdin.on('data', onStdinData);
  io.stdin.on('end', onStdinEnd);

  // Write the raw bytes, not a per-chunk `.toString('utf8')`: the remote's
  // stdout/stderr is read in raw pipe-sized chunks (commonly 64 KiB), and a
  // multibyte UTF-8 character can straddle a chunk boundary. Decoding each
  // chunk independently turns the half that lands in each chunk into a
  // replacement character; `Io.Writable` takes a `Uint8Array` exactly so a
  // command can hand the bytes on unmodified, the same as connect.ts's pty
  // stream already does.
  stream.onData((data) => {
    const { channel, payload } = demuxExecData(data);
    writeChannelOutput(io, channel, payload);
  });

  const exitCode = await new Promise<number>((resolve) => {
    stream.onClose((reason) => {
      io.stdin.removeListener?.(
        'data',
        onStdinData as (...a: unknown[]) => void
      );
      io.stdin.removeListener?.('end', onStdinEnd as (...a: unknown[]) => void);
      const exit = decodeExecExit(reason);
      if (!exit) {
        io.stderr.write(
          `beam: exec ended without an exit code: ${
            reason ?? 'stream closed'
          }\n`
        );
        resolve(1);
        return;
      }
      if (exit.signal) {
        io.stderr.write(
          `beam: remote process ended on signal ${exit.signal}\n`
        );
        resolve(1);
        return;
      }
      resolve(exit.exitCode ?? 1);
    });
  });

  connection.close();
  return exitCode;
}
