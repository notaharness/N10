import type { Beat } from '@/components/demo/model';

/** Sessions that finished before the page loaded: one beat each. */
export const COMMAND_PALETTE: readonly Beat[] = [
  {
    at: 0,
    blocks: [
      { kind: 'banner', cwd: '~/code/atlas/.claude/worktrees/command-palette' },
      {
        kind: 'prompt',
        lines: ['address the two review comments on #128, then push'],
      },
      { kind: 'collapsed', text: 'Read 2 files' },
      {
        kind: 'edit',
        verb: 'Update',
        path: 'src/palette/palette.ts',
        note: 'Added 2 lines, removed 1 line',
        rows: [
          { n: 24, sign: ' ', code: "  if (event.key === 'Escape') {" },
          { n: 25, sign: ' ', code: '    open = false;' },
          { n: 26, sign: '+', code: "    query = '';" },
          { n: 27, sign: ' ', code: '    render();' },
          { sign: '…' },
          {
            n: 36,
            sign: '-',
            code: '  const results = filterCommands(query);',
          },
          {
            n: 37,
            sign: '+',
            code: '  const results = filterCommands(debounced(query));',
          },
          {
            n: 38,
            sign: '+',
            code: '  // One pass per settled query, not per keystroke.',
          },
        ],
      },
      {
        kind: 'tool',
        name: 'Bash',
        arg: 'npx vitest run src/palette && git push',
        out: [
          [
            [' Test Files  ', 'dim'],
            ['2 passed', 'bold ok'],
            [' (2)', 'dim'],
          ],
          [
            ['      Tests  ', 'dim'],
            ['9 passed', 'bold ok'],
            [' (9)', 'dim'],
          ],
          '   5be07d2..71c0d4a  command-palette -> command-palette',
        ],
      },
      {
        kind: 'say',
        paragraphs: [
          'Both threads are handled and pushed in `71c0d4a`: Escape clears the query before closing, so reopening starts empty, and filtering waits for the query to settle instead of running on every keystroke.',
        ],
      },
      { kind: 'done', text: 'Worked for 2m 4s' },
    ],
    ci: 'running',
  },
];

export const REVIEW: readonly Beat[] = [
  {
    at: 0,
    blocks: [
      {
        kind: 'banner',
        cwd: '~/code/atlas/.claude/worktrees/fix-session-restore',
      },
      {
        kind: 'prompt',
        lines: ['review #131 for me. what should I look at first?'],
      },
      {
        kind: 'tool',
        name: 'Bash',
        arg: 'gh pr diff 131',
        out: [[['… +214 lines (ctrl+o to expand)', 'dim']]],
      },
      {
        kind: 'say',
        paragraphs: [
          'The fix is sound: restore now waits for the session list before reattaching, which is what made it flaky. Three things, in order:',
          '1. `restore.ts:58` swallows the error from `listSessions` and restores nothing. Worth logging at least.',
          '2. The new retry loop has no upper bound; one stuck tmux server would spin it forever.',
          '3. `restore.spec.ts` asserts on a 50ms sleep, so the flake may just have moved into the test.',
        ],
      },
      { kind: 'done', text: 'Crunched for 48s' },
    ],
    ci: 'running',
  },
];
