import { describe, expect, it } from 'vitest';
import { run } from './run.js';
import { makeFakeIo } from './test-support/fake-io.js';

describe('run() dispatch', () => {
  it('exits 2 and prints usage when no command is given', async () => {
    const io = makeFakeIo();
    const code = await run([], io);
    expect(code).toBe(2);
    expect(io.stderrText()).toContain('Usage: beam <command>');
  });

  it('prints usage to stdout and exits 0 for --help', async () => {
    const io = makeFakeIo();
    const code = await run(['--help'], io);
    expect(code).toBe(0);
    expect(io.stdoutText()).toContain('Usage: beam <command>');
  });

  it('names the valid commands for an unknown one, and exits 2', async () => {
    const io = makeFakeIo();
    const code = await run(['frobnicate'], io);
    expect(code).toBe(2);
    expect(io.stderrText()).toContain('unknown command "frobnicate"');
    expect(io.stderrText()).toContain('serve');
    expect(io.stderrText()).toContain('exec');
    expect(io.stderrText()).toContain('msg');
  });

  it('exits 2 on a command-level usage error without a stack trace', async () => {
    const io = makeFakeIo();
    const code = await run(['peer', 'rename'], io);
    expect(code).toBe(2);
    expect(io.stderrText()).toContain('usage: beam peer rename');
    expect(io.stderrText()).not.toContain('at ');
  });

  it('a leading --help on a subcommand prints usage and exits 0, not a usage error', async () => {
    const io = makeFakeIo();
    const code = await run(['serve', '--help'], io);
    expect(code).toBe(0);
    expect(io.stdoutText()).toContain('Usage: beam <command>');
    expect(io.stderrText()).toBe('');
  });

  it('-h works the same as --help on a subcommand', async () => {
    const io = makeFakeIo();
    const code = await run(['msg', 'send', '-h'], io);
    expect(code).toBe(0);
    expect(io.stdoutText()).toContain('Usage: beam <command>');
  });
});
