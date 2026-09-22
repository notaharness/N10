/**
 * beam `exec` stream handler — the `ssh host cmd` contract: run an argv,
 * pipe stdin, get stdout, stderr and an exit code. `argv[0]` runs directly,
 * no shell, no word splitting. See docs/beam.md.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { Readable } from 'node:stream';
import { injectedEnv, type NodeEnvContext } from './injected-env.js';
import { PeerSessions } from './peer-sessions.js';
import { isStringArray, isStringRecord } from './open-params.js';
import { resolveCwd } from './resolve-cwd.js';
import type { StreamOpenHandler } from './stream-registry.js';
import type { BeamStream } from './stream.js';

/** The one-byte channel prefix every Data frame on an `exec` stream carries. */
export const EXEC_CHANNEL_STDIN = 0;
export const EXEC_CHANNEL_STDOUT = 1;
export const EXEC_CHANNEL_STDERR = 2;

export interface ExecExit {
  exitCode: number | null;
  signal: string | null;
}

/** The host encodes its Close reason as this JSON, so a caller can recover
 * the exit code and signal without a side channel. */
export function encodeExecExit(exit: ExecExit): string {
  return JSON.stringify(exit);
}

/** Parse a Close reason produced by `encodeExecExit`; null if it isn't one
 * (e.g. the stream closed for some other reason, such as a spawn failure). */
export function decodeExecExit(reason: string | undefined): ExecExit | null {
  if (!reason) return null;
  try {
    const parsed: unknown = JSON.parse(reason);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'exitCode' in parsed &&
      'signal' in parsed
    ) {
      return parsed as ExecExit;
    }
  } catch {
    // Not our encoding — a spawn failure or another close reason.
  }
  return null;
}

/** Prefix a channel byte onto a payload for the wire. */
export function prefixChannel(channel: number, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.byteLength + 1);
  out[0] = channel;
  out.set(data, 1);
  return out;
}

/** Split a channel-prefixed Data frame payload back apart. */
export function demuxExecData(data: Uint8Array): {
  channel: number;
  payload: Uint8Array;
} {
  return { channel: data[0] ?? -1, payload: data.subarray(1) };
}

/** Upper bound on live `exec` children per peer. The same budget and the
 * same reasoning as `pty`'s MAX_PTY_SESSIONS (D5): a node's `exec` handler
 * spawns a real child process per stream, so without one, a single peer
 * could run the machine out of processes — and enforcing it per peer
 * rather than globally is what stops one peer consuming another's share. */
export const MAX_EXEC_SESSIONS = 32;

const EMPTY_NODE: NodeEnvContext = {
  beamDir: '',
  inboxSocketPath: '',
  ownPeerId: '',
};

/** Create a fresh handler; `node` supplies the injected-environment facts
 * (A4). Optional so unit tests can drive the handler without a real node
 * directory. */
export function createExecStreamHandler(
  node?: NodeEnvContext
): StreamOpenHandler {
  const sessions = new PeerSessions<ChildProcess>(MAX_EXEC_SESSIONS);

  return (stream: BeamStream) => {
    if (sessions.atLimit(stream.peer.peerId)) {
      stream.close('too many live exec sessions');
      return;
    }
    const argv = stream.openParams?.['argv'];
    if (!isStringArray(argv) || argv.length === 0) {
      stream.close('exec requires a non-empty argv');
      return;
    }
    const cwdResult = resolveCwd(stream.openParams?.['cwd']);
    if (!cwdResult.ok) {
      stream.close(cwdResult.reason);
      return;
    }
    const overrides = stream.openParams?.['env'];
    const env = injectedEnv(
      node ?? EMPTY_NODE,
      stream.peer,
      isStringRecord(overrides) ? overrides : {}
    );
    const [file, ...args] = argv;
    let proc: ChildProcess;
    try {
      // `detached: true` puts the child in its own process group (its pid
      // becomes the pgid), so a close from the caller can kill the whole
      // tree — a `tmux` or `git` child must not survive its stream.
      proc = spawn(file, args, {
        cwd: cwdResult.cwd,
        env,
        detached: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      stream.close(
        `cannot spawn ${file}: ${(error as Error).message.split('\n')[0]}`
      );
      return;
    }
    const sessionKey = sessions.key(stream);
    sessions.add(sessionKey, proc);
    wireExec(stream, proc, sessions, sessionKey);
  };
}

/** Forward one child output stream to the BeamStream, one chunk at a time:
 * pause the source immediately after each chunk and resume on a
 * `setImmediate`. This does *not* actually throttle the child to the
 * transport's own pace — `resume()` fires regardless of whether the `ws`
 * send queue (or any other transport) is keeping up, so a fast child can
 * still run the transport's own outbound buffer up without bound. What it
 * does bound is how much this process itself buffers on the *read* side: at
 * most one chunk (Node's pipe highWaterMark) sits between reads, rather
 * than the child's output piling up unread in this process while a slow
 * transport is bypassed entirely. A large `tmux capture-pane` can still
 * grow the transport's own send queue; gating on that (e.g. `bufferedAmount`
 * and a drain event) is real backpressure and is not implemented here. */
function pumpChannel(
  source: NodeJS.ReadableStream,
  channel: number,
  stream: BeamStream
): void {
  // A read error on the child's own stdout/stderr pipe must not crash the
  // whole node — same class of bug as the stdin write this file guards
  // against below (D3's audit).
  source.on('error', () => undefined);
  source.on('data', (chunk: Buffer) => {
    source.pause();
    stream.write(prefixChannel(channel, chunk));
    setImmediate(() => source.resume());
  });
}

function killProcessGroup(proc: ChildProcess): void {
  if (!proc.pid) return;
  try {
    process.kill(-proc.pid, 'SIGKILL');
  } catch {
    // Already gone.
  }
}

function wireExec(
  stream: BeamStream,
  proc: ChildProcess,
  sessions: PeerSessions<ChildProcess>,
  sessionKey: string
): void {
  let settled = false;
  let stdinEnded = false;
  pumpChannel(proc.stdout ?? neverReadable(), EXEC_CHANNEL_STDOUT, stream);
  pumpChannel(proc.stderr ?? neverReadable(), EXEC_CHANNEL_STDERR, stream);

  // D3: the actual fix is the `stdinEnded` guard below — never write to
  // stdin once it has been ended. This listener is the second layer: it
  // exists so that if a write ever does race an end anyway (a bug in this
  // class, here or added later), it surfaces as a normal, swallowed error
  // instead of an unhandled 'error' event that takes down the whole node
  // process (ERR_STREAM_WRITE_AFTER_END) — which is exactly what an EOF
  // followed by more stdin from any paired peer, hostile or merely
  // reordering, did before this fix.
  proc.stdin?.on('error', () => undefined);

  stream.onData((data) => {
    const { channel, payload } = demuxExecData(data);
    if (channel !== EXEC_CHANNEL_STDIN || stdinEnded) return;
    proc.stdin?.write(Buffer.from(payload));
  });
  // EOF is an explicit Control message, not a zero-length Data frame: a
  // zero-length chunk is not worth defending as a meaning distinct from "an
  // empty write", and Control is already the stream's unambiguous
  // out-of-band channel (it already carries acks).
  stream.onControl((message) => {
    if (message['kind'] !== 'stdin-eof' || stdinEnded) return;
    stdinEnded = true;
    proc.stdin?.end();
  });

  proc.on('exit', (exitCode, signal) => {
    sessions.release(sessionKey, proc);
    if (settled) return;
    settled = true;
    stream.close(encodeExecExit({ exitCode, signal }));
  });
  proc.on('error', (error) => {
    sessions.release(sessionKey, proc);
    if (settled) return;
    settled = true;
    stream.close(`exec failed: ${error.message.split('\n')[0]}`);
  });

  stream.onClose(() => {
    sessions.release(sessionKey, proc);
    killProcessGroup(proc);
  });
  stream.control({ kind: 'opened' });
}

/** A readable that never emits, for the (practically unreachable) case a
 * piped child has no stdout/stderr stream. */
function neverReadable(): NodeJS.ReadableStream {
  return new Readable({ read: () => undefined });
}
