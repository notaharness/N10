import type { Beat } from '@/components/demo/model';

/**
 * PR #124, babysat. n10 types a status update into the agent's session
 * when the pull request has news (the wording is composeBabysitPrompt's,
 * libs/core/src/lib/babysit/babysit-prompt.ts); Claude fixes the
 * failing check, answers the review thread and pushes, and CI goes green.
 */
const CWD = '~/code/atlas/.claude/worktrees/retry-backoff';

const FIRST_UPDATE = [
  'Status update for PR #124 ("Retry transient network failures", retry-backoff → main):',
  '',
  'CI: failed (new verdict since you were last told). Find out why and fix it.',
  'Conflicts: none against the latest origin/main.',
  '',
  'Unresolved review threads that are new or have new comments since you were last told:',
  '',
  '### 1. src/retry.ts:7  (thread PRRT_kwDOM4x2)',
  '@marcusv: Unbounded: at attempt 10 this sleeps for 100s. Cap the delay somewhere sane.',
  '',
  'Address whatever needs addressing and push your changes. Each thread above is named by the id its provider uses, so you can answer the ones you handled.',
];

const SECOND_UPDATE = [
  'Status update for PR #124 ("Retry transient network failures", retry-backoff → main):',
  '',
  'CI: passed (new verdict since you were last told).',
  'Conflicts: none against the latest origin/main.',
  '',
  'Address whatever needs addressing and push your changes. Each thread above is named by the id its provider uses, so you can answer the ones you handled.',
];

export const BABYSIT: readonly Beat[] = [
  {
    at: 0,
    blocks: [
      { kind: 'banner', cwd: CWD },
      { kind: 'prompt', lines: FIRST_UPDATE },
    ],
    working: 'Kneading',
    state: 'working',
    ci: 'failed',
    unresolved: 1,
  },
  {
    at: 3200,
    blocks: [
      {
        kind: 'tool',
        name: 'Bash',
        arg: 'gh run view 16203 --log-failed | tail -n 12',
        out: [
          [
            ['FAIL', 'err'],
            [' src/retry.test.ts > retry > keeps total backoff under 30s'],
          ],
          'AssertionError: expected 102300 to be less than or equal to 30000',
          [['… +9 lines (ctrl+o to expand)', 'dim']],
        ],
      },
    ],
  },
  {
    at: 6200,
    blocks: [{ kind: 'collapsed', text: 'Read 2 files' }],
    working: 'Sleuthing',
  },
  {
    at: 9400,
    blocks: [
      {
        kind: 'say',
        paragraphs: [
          'Same bug behind both: `sleep(2 ** i * 100)` has no ceiling, so ten attempts back off for 102s against the 30s budget the test asserts. Capping each delay at 5s brings that to 26s and answers marcusv.',
        ],
      },
    ],
  },
  {
    at: 12600,
    blocks: [
      {
        kind: 'edit',
        verb: 'Update',
        path: 'src/retry.ts',
        note: 'Added 3 lines, removed 1 line',
        rows: [
          { n: 1, sign: '+', code: 'const MAX_DELAY_MS = 5_000;' },
          { n: 2, sign: '+', code: '' },
          {
            n: 3,
            sign: ' ',
            code: 'export async function retry<T>(fn: () => Promise<T>, attempts = 5) {',
          },
          { sign: '…' },
          { n: 7, sign: ' ', code: '    } catch (error) {' },
          { n: 8, sign: ' ', code: '      if (i >= attempts) throw error;' },
          { n: 7, sign: '-', code: '      await sleep(2 ** i * 100);' },
          {
            n: 9,
            sign: '+',
            code: '      await sleep(Math.min(2 ** i * 100, MAX_DELAY_MS));',
          },
          {
            n: 10,
            sign: '+',
            code: '      // Ten attempts now back off for 26s in total, not 102s.',
          },
          { n: 11, sign: ' ', code: '    }' },
        ],
      },
    ],
    working: 'Tinkering',
  },
  {
    at: 16200,
    blocks: [
      {
        kind: 'tool',
        name: 'Bash',
        arg: 'npx vitest run src/retry.test.ts',
        out: [
          [[' ✓', 'ok'], [' src/retry.test.ts '], ['(6 tests) 41ms', 'dim']],
          '',
          [
            [' Test Files  ', 'dim'],
            ['1 passed', 'bold ok'],
            [' (1)', 'dim'],
          ],
          [
            ['      Tests  ', 'dim'],
            ['6 passed', 'bold ok'],
            [' (6)', 'dim'],
          ],
        ],
      },
    ],
  },
  {
    at: 20400,
    blocks: [
      {
        kind: 'tool',
        name: 'Bash',
        arg: 'git commit -am "fix(net): cap retry backoff at 5s" && git push',
        out: [
          '[retry-backoff 3f9c2e1] fix(net): cap retry backoff at 5s',
          ' 1 file changed, 3 insertions(+), 1 deletion(-)',
          'To github.com:atlas-dev/atlas.git',
          '   a81d0b4..3f9c2e1  retry-backoff -> retry-backoff',
        ],
      },
    ],
    ci: 'running',
    announce: 'retry-backoff pushed a fix; CI is running on pull request 124.',
  },
  {
    at: 23600,
    blocks: [
      {
        kind: 'tool',
        name: 'Bash',
        arg: 'gh api graphql -f query=@reply-and-resolve.graphql -f thread=PRRT_kwDOM4x2',
        out: [
          [
            [
              '{"data":{"resolveReviewThread":{"thread":{"isResolved":true}}}}',
              'dim',
            ],
          ],
        ],
      },
    ],
    unresolved: 0,
  },
  {
    at: 26400,
    blocks: [
      {
        kind: 'say',
        paragraphs: [
          'Pushed `3f9c2e1`. The failing check and the review thread were the same bug: the backoff had no ceiling. It is now capped at `MAX_DELAY_MS` (5s), the suite passes locally, and I replied on `PRRT_kwDOM4x2` and resolved it.',
        ],
      },
      { kind: 'done', text: 'Brewed for 26s' },
    ],
    working: null,
    state: 'idle',
  },
  {
    at: 36000,
    blocks: [{ kind: 'prompt', lines: SECOND_UPDATE }],
    working: 'Checking',
    state: 'working',
    ci: 'passed',
    announce: 'CI passed on pull request 124.',
  },
  {
    at: 39000,
    blocks: [
      {
        kind: 'say',
        paragraphs: [
          'CI is green on `3f9c2e1` and there are no open threads. Nothing left to do on #124 until review comes back.',
        ],
      },
      { kind: 'done', text: 'Worked for 3s' },
    ],
    working: null,
    state: 'idle',
  },
];
