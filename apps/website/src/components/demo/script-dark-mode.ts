import type { Beat } from '@/components/demo/model';

/**
 * The dark-mode worktree: Claude works on a feature and stops at a
 * permission prompt, which is what flags the worktree as waiting in
 * the sidebar. Answering it in the terminal lets the turn finish.
 */
const CWD = '~/code/atlas/.claude/worktrees/dark-mode';

export const DARK_MODE: readonly Beat[] = [
  {
    at: 0,
    blocks: [
      { kind: 'banner', cwd: CWD },
      {
        kind: 'prompt',
        lines: [
          'add a dark theme to settings. follow the OS by default, remember an explicit choice, and no flash of the wrong theme on load',
        ],
      },
    ],
    working: 'Pondering',
    state: 'working',
  },
  {
    at: 3800,
    blocks: [{ kind: 'collapsed', text: 'Read 3 files' }],
  },
  {
    at: 7000,
    blocks: [
      {
        kind: 'say',
        paragraphs: [
          'Preferences already persist through `usePreference`, so the choice goes there as `theme: "system" | "light" | "dark"`. To avoid the flash, a small inline script in `index.html` sets the class on `<html>` before the bundle loads.',
        ],
      },
    ],
    working: 'Crafting',
  },
  {
    at: 10400,
    blocks: [
      {
        kind: 'edit',
        verb: 'Update',
        path: 'src/settings/preferences.ts',
        note: 'Added 2 lines, removed 1 line',
        rows: [
          { n: 12, sign: ' ', code: 'export interface Preferences {' },
          { n: 13, sign: ' ', code: "  density: 'compact' | 'comfortable';" },
          { n: 14, sign: '+', code: "  theme: 'system' | 'light' | 'dark';" },
          { n: 15, sign: ' ', code: '}' },
          { sign: '…' },
          {
            n: 21,
            sign: '-',
            code: "export const DEFAULTS = { density: 'comfortable' };",
          },
          { n: 22, sign: '+', code: 'export const DEFAULTS: Preferences = {' },
          {
            n: 23,
            sign: '+',
            code: "  density: 'comfortable', theme: 'system' };",
          },
        ],
      },
    ],
  },
  {
    at: 13600,
    blocks: [
      {
        kind: 'edit',
        verb: 'Write',
        path: 'src/theme/boot.ts',
        note: 'Wrote 11 lines to src/theme/boot.ts',
        rows: [
          {
            n: 1,
            sign: ' ',
            code: '// Inlined into index.html; runs before first paint.',
          },
          {
            n: 2,
            sign: ' ',
            code: "const saved = localStorage.getItem('atlas.theme');",
          },
          { n: 3, sign: ' ', code: "const dark = saved ? saved === 'dark'" },
          {
            n: 4,
            sign: ' ',
            code: "  : matchMedia('(prefers-color-scheme: dark)').matches;",
          },
          {
            n: 5,
            sign: ' ',
            code: "document.documentElement.classList.toggle('dark', dark);",
          },
          { sign: '…' },
        ],
      },
    ],
  },
  {
    at: 16400,
    gate: {
      command: 'npm run build',
      why: 'Build to check the inlined boot script lands in index.html',
      options: ['Yes', "Yes, and don't ask again for: npm run build", 'No'],
      reject: 2,
    },
    announce: 'dark-mode is waiting for permission to run npm run build.',
  },
  {
    at: 17200,
    blocks: [
      {
        kind: 'tool',
        name: 'Bash',
        arg: 'npm run build',
        out: [
          '> atlas@0.9.0 build',
          '> vite build',
          '',
          [['✓', 'ok'], [' 214 modules transformed.']],
          [
            ['dist/', 'dim'],
            ['index.html                 '],
            ['1.12 kB', 'bold'],
            [' │ gzip: 0.61 kB', 'dim'],
          ],
          [
            ['dist/', 'dim'],
            ['assets/index-B3k2x9Qe.js   '],
            ['148.40 kB', 'bold'],
            [' │ gzip: 47.93 kB', 'dim'],
          ],
          [['✓ built in 1.84s', 'ok']],
        ],
      },
    ],
    working: 'Verifying',
    state: 'working',
  },
  {
    at: 20600,
    blocks: [
      {
        kind: 'say',
        paragraphs: [
          'Done. **Settings → Appearance** has a System / Light / Dark switch; the choice is saved as `atlas.theme` and applied before first paint, so a reload in dark mode never flashes white. The build is clean.',
        ],
      },
      { kind: 'done', text: 'Sautéed for 21s' },
    ],
    working: null,
    state: 'idle',
    announce: 'dark-mode finished.',
  },
];
