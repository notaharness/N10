/** A fake `Io` for driving `run()` in tests: captures everything written to
 * stdout/stderr, and a stdin an assembling test can push chunks into. */

import { EventEmitter } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Io, ReadableLike } from '../io.js';

/** A real `process.stdin` piped from a fast writer does not drop data
 * pushed before a command attaches its first `'data'` listener — Node
 * buffers at the OS pipe level until something reads. This fake replicates
 * that: a chunk pushed with no listener yet queues instead of vanishing,
 * and drains to the first listener that attaches.
 *
 * Composes an `EventEmitter` rather than extending it, so `on`'s type can
 * be the exact narrow `ReadableLike` shape every caller here uses, without
 * fighting `EventEmitter#on`'s own much broader overload set. */
export class FakeStdin implements ReadableLike {
  private readonly emitter = new EventEmitter();
  private queued: (string | Buffer)[] = [];
  private ended = false;
  /** Settable per test — real `process.stdin.isTTY` is `true` only when
   * stdin is a real terminal; a fake defaults to `undefined` (piped),
   * matching how tests already push/`end()` stdin explicitly. */
  isTTY?: boolean;

  on: ReadableLike['on'] = (
    event: string,
    listener: (...args: never[]) => void
  ): this => {
    this.emitter.on(event, listener as (...args: unknown[]) => void);
    if (event === 'data' && this.queued.length > 0) {
      const pending = this.queued;
      this.queued = [];
      for (const chunk of pending)
        (listener as (chunk: unknown) => void)(chunk);
    }
    if (event === 'end' && this.ended) (listener as () => void)();
    return this;
  };

  push(chunk: string | Buffer): void {
    if (this.emitter.listenerCount('data') > 0)
      this.emitter.emit('data', chunk);
    else this.queued.push(chunk);
  }

  end(): void {
    this.ended = true;
    this.emitter.emit('end');
  }
}

export interface FakeIo extends Io {
  stdin: FakeStdin;
  stdoutText(): string;
  stderrText(): string;
  stdoutLines(): string[];
}

/** Buffer raw chunks and decode once, on read — not per chunk. A command
 * that correctly forwards raw `Uint8Array` output can still split a
 * multibyte UTF-8 character across two `write()` calls (that is the whole
 * point of the exec.ts fix this exists to let a test observe); decoding
 * each chunk with its own `.toString()` would reintroduce exactly that
 * corruption in the test harness itself, even once the command under test
 * is correct. */
function byteBuffer(): {
  write: (chunk: string | Uint8Array) => void;
  text: () => string;
} {
  const chunks: Buffer[] = [];
  return {
    write: (chunk) => {
      chunks.push(
        typeof chunk === 'string'
          ? Buffer.from(chunk, 'utf8')
          : Buffer.from(chunk)
      );
    },
    text: () => Buffer.concat(chunks).toString('utf8'),
  };
}

export function makeFakeIo(
  env: Record<string, string | undefined> = {}
): FakeIo {
  const stdout = byteBuffer();
  const stderr = byteBuffer();
  const stdin = new FakeStdin();
  return {
    stdout: { write: stdout.write },
    stderr: { write: stderr.write },
    stdin,
    env,
    exit: () => undefined,
    stdoutText: stdout.text,
    stderrText: stderr.text,
    stdoutLines: () =>
      stdout
        .text()
        .split('\n')
        .filter((line) => line.length > 0),
  };
}

/** A fresh `$BEAM_DIR` in a temp directory, wired into a fake `Io`'s env —
 * every command reads `$BEAM_CONFIG_DIR` through `resolveBeamDir`. */
export function makeFakeIoWithBeamDir(label = 'beam-cli-test-'): {
  io: FakeIo;
  beamDir: string;
} {
  const beamDir = mkdtempSync(join(tmpdir(), label));
  return { io: makeFakeIo({ BEAM_CONFIG_DIR: beamDir }), beamDir };
}

export async function waitFor<T>(
  read: () => T | Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs = 5000
): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = await read();
    if (predicate(value)) return value;
    if (Date.now() - started > timeoutMs) {
      throw new Error(
        `timed out waiting for condition; last value: ${JSON.stringify(value)}`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
