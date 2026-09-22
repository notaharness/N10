import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import { installStdioErrorHandlers, realIo } from './io.js';

function errno(code: string, message = code): Error {
  const error = new Error(message) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

interface Harness {
  stdout: EventEmitter;
  stderr: EventEmitter;
  exits: number[];
  warnings: string[];
}

function install(decidedExitCode = 0): Harness {
  const harness: Harness = {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    exits: [],
    warnings: [],
  };
  installStdioErrorHandlers({
    stdout: harness.stdout,
    stderr: harness.stderr,
    exitCode: () => decidedExitCode,
    exit: (code) => harness.exits.push(code),
    warn: (message) => harness.warnings.push(message),
  });
  return harness;
}

describe('installStdioErrorHandlers', () => {
  it('ends quietly on a closed stdout pipe instead of throwing', () => {
    const harness = install();
    // With no 'error' listener this emit is an uncaught exception — the
    // stack trace `beam exec box -- noisy | head -1` used to print.
    expect(() => harness.stdout.emit('error', errno('EPIPE'))).not.toThrow();
    expect(harness.exits).toEqual([0]);
    expect(harness.warnings).toEqual([]);
  });

  it('keeps an exit code that has already been decided', () => {
    const harness = install(7);
    harness.stdout.emit('error', errno('EPIPE'));
    expect(harness.exits).toEqual([7]);
  });

  it('ends quietly on a closed stderr pipe too', () => {
    const harness = install(2);
    harness.stderr.emit('error', errno('EPIPE'));
    expect(harness.exits).toEqual([2]);
    expect(harness.warnings).toEqual([]);
  });

  it('reports a write failure that is not a closed pipe and exits 1', () => {
    const harness = install();
    harness.stdout.emit('error', errno('ENOSPC', 'no space left on device'));
    expect(harness.exits).toEqual([1]);
    expect(harness.warnings).toEqual(['beam: no space left on device\n']);
  });

  it('ends once even when both streams fail', () => {
    const harness = install(3);
    harness.stdout.emit('error', errno('EPIPE'));
    harness.stderr.emit('error', errno('EPIPE'));
    expect(harness.exits).toEqual([3]);
  });
});

describe('realIo', () => {
  const attached: (() => void)[] = [];

  afterEach(() => {
    for (const detach of attached.splice(0)) detach();
  });

  it('attaches the error handlers to the real stdout and stderr', () => {
    const before = {
      stdout: process.stdout.listenerCount('error'),
      stderr: process.stderr.listenerCount('error'),
    };
    const io = realIo();
    const added = {
      stdout: process.stdout.listeners('error').slice(before.stdout),
      stderr: process.stderr.listeners('error').slice(before.stderr),
    };
    attached.push(() => {
      for (const listener of added.stdout)
        process.stdout.removeListener('error', listener as () => void);
      for (const listener of added.stderr)
        process.stderr.removeListener('error', listener as () => void);
    });

    expect(io.stdout).toBe(process.stdout);
    expect(added.stdout).toHaveLength(1);
    expect(added.stderr).toHaveLength(1);
  });
});
