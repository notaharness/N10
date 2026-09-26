import type { ClaudeScript } from './claude-code.js';

/**
 * #182's agent, mid-feature when the page loads: it adds the Fleet
 * section's collapsed summary (the real `section-summary.ts`), stops
 * at a permission prompt for the e2e run, and finishes once answered.
 */
export const FLEET: ClaudeScript = {
  cwd: '~/code/n10/.claude/worktrees/feat-fleet-sidebar',
  history: [
    {
      kind: 'prompt',
      text: 'Fleet should be a sidebar section, not a screen of its own. Collapsed, its header needs a one-line state so you can tell at a glance whether anything wants you.',
    },
    { kind: 'read', files: 4 },
  ],
  beats: [
    {
      after: 600,
      working: 'Pondering',
      blocks: [
        {
          kind: 'say',
          paragraphs: [
            "The header's state is a pure function of the beam status, the machine list and whether a passkey step is waiting, so it goes in `lib/fleet/section-summary.ts` where it can be specced without rendering anything.",
          ],
        },
      ],
    },
    {
      after: 3200,
      working: 'Crafting',
      blocks: [
        {
          kind: 'edit',
          path: 'apps/desktop/src/renderer/lib/fleet/section-summary.ts',
          added: 31,
          removed: 0,
          rows: [
            { n: 11, sign: '+', code: 'export function fleetSectionSummary({' },
            { n: 12, sign: '+', code: '  beam,' },
            { n: 13, sign: '+', code: '  machines,' },
            { n: 14, sign: '+', code: '  awaitingPasskey,' },
            { sign: '…' },
            {
              n: 20,
              sign: '+',
              code: "  if (awaitingPasskey) return { text: 'Passkey step', tone: 'active' };",
            },
            { n: 24, sign: '+', code: "  if (beam.state === 'unavailable') {" },
            {
              n: 25,
              sign: '+',
              code: "    return { text: 'Unavailable', tone: 'warning' };",
            },
            { n: 26, sign: '+', code: '  }' },
            {
              n: 27,
              sign: '+',
              code: "  if (!beam.enrolled) return { text: 'Not set up', tone: 'muted' };",
            },
          ],
        },
      ],
    },
    {
      after: 4200,
      blocks: [
        {
          kind: 'tool',
          name: 'Bash',
          arg: 'npx nx test desktop -- section-summary',
          out: [
            [
              [' ✓', ['bgreen']],
              [' src/renderer/lib/fleet/section-summary.spec.ts '],
              ['(7 tests) 6ms', ['gray']],
            ],
            '',
            [
              [' Test Files  ', ['gray']],
              ['1 passed', ['bold', 'bgreen']],
              [' (1)', ['gray']],
            ],
            [
              ['      Tests  ', ['gray']],
              ['7 passed', ['bold', 'bgreen']],
              [' (7)', ['gray']],
            ],
          ],
        },
      ],
    },
    {
      after: 3000,
      gate: {
        command:
          'GH_TOKEN=$(gh auth token) npx nx e2e desktop-e2e -- fleet-sidebar',
        why: 'Run the fleet sidebar end-to-end tests against the built app',
        options: ['Yes', "Yes, and don't ask again for: npx nx e2e *", 'No'],
        reject: 2,
      },
    },
    {
      after: 800,
      working: 'Testing',
      blocks: [
        {
          kind: 'tool',
          name: 'Bash',
          arg: 'GH_TOKEN=$(gh auth token) npx nx e2e desktop-e2e -- fleet-sidebar',
          out: [
            'Running 5 tests using 1 worker',
            [
              ['  ✓', ['bgreen']],
              [
                '  fleet-sidebar.test.ts › the section shows the fleet collapsed',
                ['gray'],
              ],
            ],
            [
              ['  ✓', ['bgreen']],
              [
                '  fleet-sidebar.test.ts › a passkey step outranks every other state',
                ['gray'],
              ],
            ],
            [['… +3 lines (ctrl+o to expand)', ['gray']]],
            [
              ['  5 passed', ['bgreen']],
              [' (41.2s)', ['gray']],
            ],
          ],
        },
      ],
    },
    {
      after: 5000,
      working: null,
      blocks: [
        {
          kind: 'say',
          paragraphs: [
            'Fleet now lives in the sidebar as a collapsible section. Collapsed, its header reads **Passkey step**, **Unavailable**, **Not set up** or the machine count, in that order of urgency. Unit and e2e tests pass; ready for your hands-on round.',
          ],
        },
        { kind: 'done', text: 'Baked for 4m 12s' },
      ],
    },
  ],
  reply: () => [
    {
      after: 900,
      working: 'Thinking',
    },
    {
      after: 2400,
      working: null,
      blocks: [
        {
          kind: 'say',
          paragraphs: [
            "This session is part of n10's demo, so it can't act on that. In n10 itself this is a real Claude Code, in a real terminal, in the worktree's own tmux session.",
          ],
        },
      ],
    },
  ],
};
