import type { ClaudeScript } from './claude-code.js';

/**
 * beam #39's agent, running on the rented server: it finishes the
 * homepage's reduced-motion handling and refreshes the page's CSP
 * hashes, the real change in that pull request.
 */
export const HOMEPAGE: ClaudeScript = {
  cwd: '~/code/beam/.claude/worktrees/feat-homepage',
  history: [
    {
      kind: 'prompt',
      text: "beam.n10.is with no fragment should be beam's homepage: what beam is, two machines joined by a beam, and where to start. The packets move only without prefers-reduced-motion.",
    },
    { kind: 'read', files: 3 },
  ],
  beats: [
    {
      after: 1400,
      working: 'Composing',
      blocks: [
        {
          kind: 'edit',
          path: 'worker/public/index.html',
          added: 11,
          removed: 1,
          rows: [
            { n: 44, sign: '-', code: 'footer a { color: inherit; }' },
            { n: 44, sign: '+', code: 'a { color: inherit; }' },
            {
              n: 45,
              sign: '+',
              code: '.scene { display: block; width: 100%; height: auto; }',
            },
            {
              n: 49,
              sign: '+',
              code: '.scene .packet { stroke: var(--packet); stroke-dasharray: 6 94; }',
            },
            {
              n: 50,
              sign: '+',
              code: '@media (prefers-reduced-motion: no-preference) {',
            },
            {
              n: 51,
              sign: '+',
              code: '  .scene .packet { animation: beam 2.4s linear infinite; }',
            },
            { n: 54, sign: '+', code: '}' },
          ],
        },
      ],
    },
    {
      after: 5200,
      blocks: [
        {
          kind: 'tool',
          name: 'Bash',
          arg: 'node worker/scripts/csp-hashes.mjs --write',
          out: [
            "script-src 'sha256-k0atXgUAhP3tH3XUKxEN7UvV74vTlP05Q8TUGoBqa1o='",
            "style-src  'sha256-7JYqHCbEl/C9GXHNHaBgMF6qyeOgVMp7H9Anmu34eIE='",
            [['updated worker/public/_headers', ['gray']]],
          ],
        },
      ],
    },
    {
      after: 4200,
      working: 'Testing',
      blocks: [
        {
          kind: 'tool',
          name: 'Bash',
          arg: 'cd worker && npm test',
          out: [
            [
              [' ✓', ['bgreen']],
              [' test/page.test.ts '],
              ['(18 tests) 211ms', ['gray']],
            ],
            [
              [' ✓', ['bgreen']],
              [' test/flows.test.mjs '],
              ['(9 tests) 1.3s', ['gray']],
            ],
            '',
            [
              ['      Tests  ', ['gray']],
              ['27 passed', ['bold', 'bgreen']],
              [' (27)', ['gray']],
            ],
          ],
        },
      ],
    },
    {
      after: 4400,
      working: null,
      blocks: [
        {
          kind: 'say',
          paragraphs: [
            "With no fragment the page is now beam's homepage, and the packets only move without `prefers-reduced-motion: reduce`. The inline style and script changed, so `_headers` carries their new hashes; both worker suites pass.",
          ],
        },
        { kind: 'done', text: 'Churned for 1m 48s' },
      ],
    },
  ],
};
