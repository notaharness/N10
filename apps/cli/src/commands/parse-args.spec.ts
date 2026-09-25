import { parseArgs } from './parse-args.js';

describe('parseArgs', () => {
  it('opens the desktop with no arguments', () => {
    expect(parseArgs([])).toEqual({ kind: 'desktop' });
  });

  it('runs the TUI with what follows --tui', () => {
    expect(parseArgs(['--tui'])).toEqual({ kind: 'tui', args: [] });
    expect(parseArgs(['--tui', '/repo'])).toEqual({
      kind: 'tui',
      args: ['/repo'],
    });
  });

  it('hands util its subcommand and flags', () => {
    expect(parseArgs(['util', 'add-comment', '--pr=7'])).toEqual({
      kind: 'util',
      args: ['add-comment', '--pr=7'],
    });
  });

  it('recognises help and version in both spellings', () => {
    expect(parseArgs(['--help'])).toEqual({ kind: 'help' });
    expect(parseArgs(['-h'])).toEqual({ kind: 'help' });
    expect(parseArgs(['--version'])).toEqual({ kind: 'version' });
    expect(parseArgs(['-v'])).toEqual({ kind: 'version' });
  });

  it('rejects anything else rather than guessing', () => {
    expect(parseArgs(['/repo'])).toEqual({ kind: 'unknown', arg: '/repo' });
    expect(parseArgs(['desktop'])).toEqual({ kind: 'unknown', arg: 'desktop' });
    // Only the first argument decides.
    expect(parseArgs(['/repo', '--tui'])).toEqual({
      kind: 'unknown',
      arg: '/repo',
    });
  });
});
