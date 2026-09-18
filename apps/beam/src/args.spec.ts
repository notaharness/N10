import { describe, expect, it } from 'vitest';
import { parseArgs } from './args.js';
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
});
