import { PR_TABS } from '../../data/n10.js';
import type { RepoState } from '../../host/state.js';
import type { Beat } from './claude-code.js';

/**
 * #177's plan: when the viewer checks out the review threads, its agent
 * works through them, pushes, answers and resolves each thread, and CI
 * goes green on the sidebar.
 */
export function tabsPlanBeats(repo: RepoState): Beat[] {
  return [
    { after: 500, working: 'Reading', blocks: [{ kind: 'read', files: 4 }] },
    {
      after: 3000,
      working: 'Tinkering',
      blocks: [
        {
          kind: 'edit',
          path: 'apps/desktop/src/renderer/lib/tabs/tabs-model.ts',
          added: 4,
          removed: 2,
          rows: [
            {
              n: 88,
              sign: ' ',
              code: 'function openItem(tabs: Tab[], repo: string, itemKey: string) {',
            },
            {
              n: 89,
              sign: '-',
              code: '  const hit = tabs.find((t) => t.itemKey === itemKey || t.id === id);',
            },
            {
              n: 89,
              sign: '+',
              code: '  // A moved tab keeps its id; only its current key may claim it.',
            },
            {
              n: 90,
              sign: '+',
              code: '  const hit = tabs.find((t) => standsFor(t, itemKey));',
            },
            {
              n: 91,
              sign: '-',
              code: '  const id = itemTabId(repo, itemKey);',
            },
            {
              n: 91,
              sign: '+',
              code: '  const id = freeId(tabs, itemTabId(repo, itemKey));',
            },
          ],
        },
      ],
    },
    {
      after: 3400,
      blocks: [
        {
          kind: 'edit',
          path: 'apps/desktop/src/host/services/worktree-sessions.ts',
          added: 1,
          removed: 1,
          rows: [
            { n: 81, sign: ' ', code: '    [...known.keys()].filter(' },
            {
              n: 82,
              sign: '-',
              code: "      (name) => sessionIdentity(name)?.kind === 'worktree'",
            },
            {
              n: 82,
              sign: '+',
              code: "      (name) => sessionIdentity(name)?.kind === 'worktree' && isAlive(name)",
            },
          ],
        },
      ],
    },
    {
      after: 3600,
      working: 'Testing',
      blocks: [
        {
          kind: 'tool',
          name: 'Bash',
          arg: 'npx nx test desktop -- tab-worktree worktree-sessions',
          out: [
            [
              [' ✓', ['bgreen']],
              [' src/renderer/lib/tabs/tab-worktree.spec.ts '],
              ['(9 tests) 12ms', ['gray']],
            ],
            [
              [' ✓', ['bgreen']],
              [' src/host/services/worktree-sessions.spec.ts '],
              ['(8 tests) 5ms', ['gray']],
            ],
            '',
            [
              ['      Tests  ', ['gray']],
              ['17 passed', ['bold', 'bgreen']],
              [' (17)', ['gray']],
            ],
          ],
        },
      ],
    },
    {
      after: 3800,
      effect: () => repo.updatePr(PR_TABS.id, { buildStatus: 'pending' }),
      blocks: [
        {
          kind: 'tool',
          name: 'Bash',
          arg: 'git commit -qam "fix(desktop): open a left-behind PR row in its own tab" && git push',
          out: [
            '   905bbcb2..c7d41e09  fix/tab-branch-switch -> fix/tab-branch-switch',
          ],
        },
      ],
    },
    {
      after: 3200,
      effect: () => repo.resolveThreads(PR_TABS.id),
      blocks: [
        {
          kind: 'tool',
          name: 'Bash',
          arg: 'gh api graphql -F query=@reply-and-resolve.graphql -f threads=PRRT_kwDOM4x2c86Rk1Fq,PRRT_kwDOM4x2c86Rk2Lw',
          out: [
            [
              [
                '{"data":{"resolveReviewThread":{"thread":{"isResolved":true}}}}',
                ['gray'],
              ],
            ],
          ],
        },
      ],
    },
    {
      after: 2800,
      working: null,
      blocks: [
        {
          kind: 'say',
          paragraphs: [
            'Both threads are fixed in `c7d41e09`. `openItem` matches a tab by its current key only and mints a free id when the derived one is taken, so the row a switch leaves behind opens its own tab. The held-session listing now skips dead sessions, so an ordinary poll no longer forks tmux. I replied on each thread and resolved it.',
          ],
        },
        { kind: 'done', text: 'Brewed for 22s' },
      ],
    },
    {
      after: 9000,
      effect: () => repo.updatePr(PR_TABS.id, { buildStatus: 'succeeded' }),
    },
  ];
}
