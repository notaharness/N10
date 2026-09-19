/**
 * The CLI's own seam: every command reads and writes only through this
 * interface, never `process.*` directly, so a test can drive `run()` with a
 * fake `io` and assert on exactly what a user would see — no spawned
 * process, no real stdin/stdout.
 */

export interface Writable {
  write(chunk: string | Uint8Array): void;
}

/** A minimal readable-stream shape: enough of Node's `Readable` to forward
 * stdin, satisfied by real `process.stdin` and by `Readable.from(...)` (or
 * an ad-hoc `EventEmitter`) in tests. */
export interface ReadableLike {
  on(event: 'data', listener: (chunk: Buffer | string) => void): unknown;
  on(event: 'end', listener: () => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  removeListener?(
    event: string,
    listener: (...args: unknown[]) => void
  ): unknown;
  /** True for a real interactive terminal, as `process.stdin.isTTY` reports
   * it — used to refuse blocking forever on an EOF that will never come
   * (e.g. `msg send` with no `--message` and nothing piped in) rather than
   * hanging. */
  isTTY?: boolean;
}

export interface Io {
  stdout: Writable;
  stderr: Writable;
  stdin: ReadableLike;
  env: Record<string, string | undefined>;
  /** Requests process termination with `code`. Real usage maps this to
   * `process.exit`; tests capture it instead of ending the test process. */
  exit: (code: number) => void;
  /** Optional cooperative cancellation for commands that would otherwise
   * run forever (`serve`, `msg listen`, `connect`) — real invocations rely
   * on OS signals instead; tests set this to end a long-running command
   * without spawning a process. */
  signal?: AbortSignal;
}

/** A stream that reports a failed write asynchronously, the way Node's
 * `process.stdout` and `process.stderr` do. */
interface ErrorReporting {
  on(event: 'error', listener: (error: Error) => void): unknown;
}

export interface StdioErrorOptions {
  stdout: ErrorReporting;
  stderr: ErrorReporting;
  /** The exit code decided so far, if the command already finished. */
  exitCode: () => number;
  /** Ends the process immediately — `process.exit` in real use. */
  exit: (code: number) => void;
  /** Reports a failure that is not a closed pipe. */
  warn: (message: string) => void;
}

/**
 * Node ignores SIGPIPE and surfaces a reader that has gone away as an
 * `'error'` event with `code: 'EPIPE'` instead. With no listener that is an
 * uncaught exception, so `beam exec box -- noisy | head -1` prints a stack
 * trace the moment `head` has seen enough — and piping into `head` or
 * `grep -q` is exactly how scripts and agents drive this CLI.
 *
 * A closed pipe is the reader's decision, not beam's failure, so the exit
 * code is whatever has already been decided (nothing yet: 0) rather than an
 * error code invented here. There is no one left to write the rest of the
 * output to, so stop rather than pump the remainder into a dead pipe.
 */
export function installStdioErrorHandlers(options: StdioErrorOptions): void {
  let ending = false;
  const onError = (error: Error): void => {
    if (ending) return;
    ending = true;
    if ((error as NodeJS.ErrnoException).code === 'EPIPE') {
      options.exit(options.exitCode());
      return;
    }
    // Any other write failure is a real one and still must not surface as
    // an uncaught exception with a stack trace.
    options.warn(`beam: ${error.message}\n`);
    options.exit(1);
  };
  options.stdout.on('error', onError);
  options.stderr.on('error', onError);
}

export function realIo(): Io {
  installStdioErrorHandlers({
    stdout: process.stdout,
    stderr: process.stderr,
    exitCode: () =>
      typeof process.exitCode === 'number' ? process.exitCode : 0,
    exit: (code) => process.exit(code),
    warn: (message) => {
      process.stderr.write(message);
    },
  });
  return {
    stdout: process.stdout,
    stderr: process.stderr,
    stdin: process.stdin,
    env: process.env,
    exit: (code) => {
      process.exitCode = code;
    },
  };
}
