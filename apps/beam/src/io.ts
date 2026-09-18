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

export function realIo(): Io {
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
