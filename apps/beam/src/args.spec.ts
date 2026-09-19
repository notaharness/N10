import { describe, expect, it } from 'vitest';
import { parseArgs } from './args.js';
import { run } from './run.js';
import { makeFakeIo } from './test-support/fake-io.js';
import { UsageError } from './usage.js';

describe('parseArgs', () => {
  it('separates positionals, a value flag, a repeatable flag and a boolean flag', () => {
    const parsed = parseArgs(
      [
        'peer1',
        '--topic',
        'orchestra',
        '--endpoint',
        'a',
        '--endpoint',
        'b',
        '--json',
      ],
      {
        valueFlags: ['topic'],
        multiFlags: ['endpoint'],
        booleanFlags: ['json'],
      }
    );
    expect(parsed.positionals).toEqual(['peer1']);
    expect(parsed.values.get('topic')).toBe('orchestra');
    expect(parsed.multi.get('endpoint')).toEqual(['a', 'b']);
    expect(parsed.booleans.has('json')).toBe(true);
  });

  it('stops flag parsing at a literal -- and preserves the rest verbatim', () => {
    const parsed = parseArgs(
      ['peer1', '--', 'git', '-C', '~/repo', 'status'],
      {}
    );
    expect(parsed.positionals).toEqual(['peer1']);
    expect(parsed.rest).toEqual(['git', '-C', '~/repo', 'status']);
  });

  it('rejects an unrecognized flag', () => {
    expect(() => parseArgs(['--bogus'], { booleanFlags: ['json'] })).toThrow(
      UsageError
    );
  });

  it('rejects a value flag given with no value', () => {
    expect(() => parseArgs(['--topic'], { valueFlags: ['topic'] })).toThrow(
      /--topic requires a value/
    );
  });

  // A value flag that swallowed the next flag would run with a value
  // nobody typed and silently drop what followed it — the invocation these
  // three cases stand for is `beam exec box --cwd --env FOO=bar -- ls`,
  // which used to run in a directory called "--env", discard FOO=bar as a
  // stray positional, and print nothing at all.
  it('refuses to take another flag as a value flag’s value', () => {
    expect(() =>
      parseArgs(['box', '--cwd', '--env', 'FOO=bar', '--', 'ls'], {
        valueFlags: ['cwd'],
        multiFlags: ['env'],
      })
    ).toThrow(
      /--cwd requires a value, but the next argument is the flag --env/
    );
  });

  it('refuses to take another flag as a repeatable flag’s value', () => {
    expect(() =>
      parseArgs(['box', '--env', '--cwd', '/srv'], {
        valueFlags: ['cwd'],
        multiFlags: ['env'],
      })
    ).toThrow(
      /--env requires a value, but the next argument is the flag --cwd/
    );
  });

  it('refuses to take the -- separator as a value flag’s value', () => {
    expect(() =>
      parseArgs(['box', '--cwd', '--', 'ls', '-la'], { valueFlags: ['cwd'] })
    ).toThrow(
      /--cwd requires a value, but the next argument is the -- argv separator/
    );
  });

  it('accepts a single-dash token as a value', () => {
    const parsed = parseArgs(['--message', '-'], { valueFlags: ['message'] });
    expect(parsed.values.get('message')).toBe('-');
  });

  it('accepts --flag=value for value and repeatable flags', () => {
    const parsed = parseArgs(['--port=8080', '--endpoint=a', '--endpoint=b'], {
      valueFlags: ['port'],
      multiFlags: ['endpoint'],
    });
    expect(parsed.values.get('port')).toBe('8080');
    expect(parsed.multi.get('endpoint')).toEqual(['a', 'b']);
  });

  it('splits --flag=value at the first = only, so the value may contain more', () => {
    const parsed = parseArgs(['--env=KEY=a=b'], { multiFlags: ['env'] });
    expect(parsed.multi.get('env')).toEqual(['KEY=a=b']);
  });

  it('accepts an inline value that itself starts with --', () => {
    const parsed = parseArgs(['--cwd=--env'], { valueFlags: ['cwd'] });
    expect(parsed.values.get('cwd')).toBe('--env');
  });

  it('accepts an empty inline value', () => {
    const parsed = parseArgs(['--topic='], { valueFlags: ['topic'] });
    expect(parsed.values.get('topic')).toBe('');
  });

  it('rejects an inline value on a boolean flag', () => {
    expect(() => parseArgs(['--json=yes'], { booleanFlags: ['json'] })).toThrow(
      /--json takes no value/
    );
  });

  it('names the flag, not the whole token, for an unrecognized --flag=value', () => {
    expect(() =>
      parseArgs(['--port=8080'], { booleanFlags: ['json'] })
    ).toThrow(/unrecognized option --port(?!=)/);
  });

  it('leaves --flag=value after a literal -- untouched', () => {
    const parsed = parseArgs(['--', 'cmd', '--cwd=/elsewhere'], {
      valueFlags: ['cwd'],
    });
    expect(parsed.rest).toEqual(['cmd', '--cwd=/elsewhere']);
    expect(parsed.values.has('cwd')).toBe(false);
  });
});

describe('beam exec argument handling', () => {
  it('exits 2 and names the flag rather than running somewhere unintended', async () => {
    const io = makeFakeIo();
    const code = await run(
      ['exec', 'workbox', '--cwd', '--env', 'FOO=bar', '--', 'ls'],
      io
    );
    expect(code).toBe(2);
    expect(io.stderrText()).toContain('--cwd requires a value');
    expect(io.stdoutText()).toBe('');
  });
});
