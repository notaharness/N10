/**
 * beam `pty` / `pty:<program>` stream handler — a real terminal, backed by
 * node-pty. Open parameters (D1): `{ argv?, cwd?, env?, cols?, rows? }`. An
 * absent or empty `argv` means the login shell; `argv[0]` is executed
 * directly, no shell, no word splitting. `pty:<program>` stays valid as a
 * shorthand for `argv: ['<program>']`. See docs/beam.md.
 */

import { existsSync } from 'node:fs';
import * as pty from 'node-pty';
import { injectedEnv, type NodeEnvContext } from './injected-env.js';
import { PeerSessions } from './peer-sessions.js';
import { isString, isStringRecord } from './open-params.js';
import { resolveCwd } from './resolve-cwd.js';
import type { StreamOpenHandler } from './stream-registry.js';
import type { BeamStream } from './stream.js';

/** Upper bound on live PTY sessions per peer (docs/beam.md's "per
 * connection"). One handler instance is shared by every connection on a
 * node (host.ts hands every connection the same StreamRegistry — A1), so
 * the cap is enforced per peerId within that shared session map, not
 * globally across the whole node: one peer opening 32 shells must not
 * shrink another peer's own budget (D5). */
export const MAX_PTY_SESSIONS = 32;
const MIN_COLS_ROWS = 2;
const MAX_COLS_ROWS = 500;
const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

/** Login shell preference: $SHELL, then bash, then sh — whatever exists. */
export function shellForEnv(): string {
  const candidates = [process.env['SHELL'], '/bin/bash', '/bin/sh'];
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return 'sh';
}

function programFor(streamName: string): string {
  return streamName.startsWith('pty:')
    ? streamName.slice(4).trim() || shellForEnv()
    : shellForEnv();
}

function clampInt(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback;
  return Math.min(MAX_COLS_ROWS, Math.max(MIN_COLS_ROWS, Math.trunc(value)));
}

function isResize(message: Record<string, unknown>): boolean {
  return message['kind'] === 'resize';
}

/**
 * Attach an `'error'` listener to a spawned pty.
 *
 * node-pty's `UnixTerminal` re-emits its socket's `'error'` on the terminal
 * itself, and an EventEmitter that emits `'error'` with nobody listening
 * throws synchronously — so a pty whose fd dies under it (EIO on a hung-up
 * master, a kernel refusing the read) takes the whole node down, from an
 * event whose timing the far side chooses. `IPty`'s typed surface exposes
 * only the `onData`/`onExit` disposables and no `on()`, so the listener has
 * to go on the EventEmitter the implementation actually is; the cast is the
 * narrowest shape that admits. Exported so the guard can be exercised
 * without having to break a real pty.
 */
/** node-pty emits `read EIO` (`errno 5` on older Node) on the master fd
 * as its ordinary signal that the child closed the pty — the exit itself,
 * which `onExit` reports a moment later with a real code and signal. It is
 * not a fault, and closing the stream on it would replace the exit status
 * a caller needs with a message about a file descriptor. Every other error
 * is a fault nothing else on this stream will report. */
export function isPtyExitError(error: Error): boolean {
  return /EIO|errno 5/.test(error.message);
}

export function guardPtyErrors(
  proc: pty.IPty,
  onError: (error: Error) => void
): void {
  const emitter = proc as unknown as {
    on?: (event: 'error', listener: (error: Error) => void) => void;
  };
  emitter.on?.('error', onError);
}

/** `argv[0]` runs directly — no shell, no word splitting — with the rest as
 * literal arguments. An absent or empty `argv` param falls back to the
 * stream-name form (`pty` -> login shell, `pty:<program>` -> that program). */
function resolveArgv(stream: BeamStream): string[] {
  const argv = stream.openParams?.['argv'];
  if (Array.isArray(argv) && argv.length > 0 && argv.every(isString)) {
    return argv as string[];
  }
  return [programFor(stream.name)];
}

/** Create a fresh handler: one instance owns the live sessions for one
 * *node* (not one connection — A1), because host.ts shares one
 * StreamRegistry across every connection. Sessions are keyed by `(peerId,
 * streamId)`, since stream ids are only unique within one connection and two
 * peers can each open stream id 1 at the same time; that same key lets
 * `MAX_PTY_SESSIONS` be enforced per peer rather than globally (D5), even
 * though every peer's sessions live in one shared map. `node` supplies the
 * facts every spawned process is told about itself (A4); it is optional so
 * unit tests can drive the handler without a real node directory. */
/** How a `pty` stream's own ending is reported on its Close frame.
 *
 * The opener has to be able to tell "the process on the far side ended"
 * from "the stream stopped for some other reason" — a dropped connection,
 * a refused scope, a handler that threw — because only the first is the
 * thing it asked for and the rest are failures. That distinction is a
 * string on the wire, so producer and consumer share this pair rather
 * than one of them matching on prose the other might reword. `exec` has
 * had the same pair since it began (`decodeExecExit`); this is the pty
 * equivalent, in the prose form pty closes have always used so a peer
 * running an older build is still understood.
 */
export interface PtyExit {
  exitCode: number;
  signal?: number;
}

const PTY_EXIT_PATTERN = /^process exited \(code (-?\d+)(?:, signal (\d+))?\)$/;

export function encodePtyExit(exit: PtyExit): string {
  const signalPart = exit.signal ? `, signal ${exit.signal}` : '';
  return `process exited (code ${exit.exitCode}${signalPart})`;
}

/** The far process's exit, or `null` when this close reason is not one —
 * which is every way a `pty` stream can end that is not the process
 * ending, and so is a failure the caller has to report rather than a
 * session that finished. */
export function decodePtyExit(reason: string | undefined): PtyExit | null {
  const match = reason === undefined ? null : PTY_EXIT_PATTERN.exec(reason);
  if (!match) return null;
  const signal = match[2] === undefined ? undefined : Number(match[2]);
  return signal === undefined
    ? { exitCode: Number(match[1]) }
    : { exitCode: Number(match[1]), signal };
}

export function createPtyStreamHandler(
  node?: NodeEnvContext
): StreamOpenHandler {
  const sessions = new PeerSessions<pty.IPty>(MAX_PTY_SESSIONS);

  return (stream: BeamStream) => {
    if (sessions.atLimit(stream.peer.peerId)) {
      stream.close('too many live pty sessions');
      return;
    }
    const cwdResult = resolveCwd(stream.openParams?.['cwd']);
    if (!cwdResult.ok) {
      stream.close(cwdResult.reason);
      return;
    }
    const [file, ...args] = resolveArgv(stream);
    const overrides = stream.openParams?.['env'];
    const env = injectedEnv(
      node ?? { beamDir: '', inboxSocketPath: '', ownPeerId: '' },
      stream.peer,
      isStringRecord(overrides) ? overrides : {}
    );
    let proc: pty.IPty;
    try {
      proc = pty.spawn(file, args, {
        name: 'xterm-256color',
        cols: clampInt(stream.openParams?.['cols'], DEFAULT_COLS),
        rows: clampInt(stream.openParams?.['rows'], DEFAULT_ROWS),
        cwd: cwdResult.cwd,
        env,
      });
    } catch (error) {
      stream.close(
        `cannot spawn ${file}: ${(error as Error).message.split('\n')[0]}`
      );
      return;
    }
    sessions.add(sessions.key(stream), proc);
    wireSession(stream, proc, sessions, sessions.key(stream));
    stream.control({ kind: 'opened' });
  };
}

function wireSession(
  stream: BeamStream,
  proc: pty.IPty,
  sessions: PeerSessions<pty.IPty>,
  sessionKey: string
): void {
  guardPtyErrors(proc, (error) => {
    if (isPtyExitError(error)) return;
    if (!sessions.release(sessionKey, proc)) return;
    stream.close(`pty error: ${error.message.split('\n')[0]}`);
  });
  proc.onData((data) => {
    if (sessions.holds(sessionKey, proc))
      stream.write(Buffer.from(data, 'utf8'));
  });
  proc.onExit(({ exitCode, signal }) => {
    if (!sessions.release(sessionKey, proc)) return;
    stream.close(encodePtyExit({ exitCode, signal }));
  });
  stream.onData((data) => {
    try {
      // Same hazard as the resize below: node-pty's write() goes at a
      // native fd that a racing process exit may already have closed, and
      // a remote peer's ordinary keystroke must never be able to throw an
      // uncaught exception out of a data-frame handler.
      proc.write(Buffer.from(data).toString('utf8'));
    } catch {
      // The pty has already exited; there is nothing left to write to.
    }
  });
  stream.onClose(() => {
    if (!sessions.release(sessionKey, proc)) return;
    try {
      proc.kill();
    } catch {
      // Already gone.
    }
  });
  stream.onControl((message) => {
    if (!isResize(message)) return;
    const cols = clampInt(message['cols'], NaN);
    const rows = clampInt(message['rows'], NaN);
    if (Number.isNaN(cols) || Number.isNaN(rows)) return;
    try {
      // node-pty's resize() is a native ioctl call and throws if the pty's
      // fd is already gone — a resize can race the process exiting. Same
      // class of bug as D3's stdin write: a remote peer's ordinary, timing-
      // dependent message must never be able to throw an uncaught
      // exception out of a control-frame handler and crash the node.
      proc.resize(cols, rows);
    } catch {
      // The pty has already exited; nothing to resize.
    }
  });
}
