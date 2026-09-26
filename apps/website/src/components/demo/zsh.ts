import type { Line } from '@/components/demo/term';

/**
 * A zsh in the perf-flamegraph worktree, with oh-my-zsh's default
 * robbyrussell prompt. It answers a handful of commands from a table;
 * anything else is "command not found". Nothing is executed.
 */
const WORKTREE = '/home/you/code/atlas/.claude/worktrees/perf-flamegraph';

export interface ZshEntry {
  cmd: string;
  out: readonly Line[];
  /** Exit status zero; the next prompt's arrow turns red otherwise. */
  ok: boolean;
}

const TMUX_LS: readonly Line[] = [
  'atlas-dark-mode: 1 windows (created Sat Sep 26 09:12:04 2026)',
  'atlas-perf-flamegraph: 1 windows (created Sat Sep 26 09:40:51 2026) (attached)',
  'atlas-retry-backoff: 1 windows (created Sat Sep 26 08:47:31 2026)',
];

const GIT_STATUS: readonly Line[] = [
  'On branch perf-flamegraph',
  'Changes not staged for commit:',
  [['        modified:   src/grid/render.ts', 'red']],
  '',
  'Untracked files:',
  [['        atlas.cpuprofile', 'red']],
];

const GIT_LOG: readonly Line[] = [
  [['e41a9c2', 'yellow'], [' perf(grid): measure rows once per frame']],
  [['9b07f13', 'yellow'], [' test(bench): add a 10k-row render benchmark']],
  [['c3d2a8e', 'yellow'], [' chore: bump vite to 7.1']],
];

const COMMANDS: Record<string, readonly Line[]> = {
  ls: [
    'README.md  atlas.cpuprofile  package.json  scripts  src  tsconfig.json',
  ],
  pwd: [WORKTREE],
  whoami: ['you'],
  'git status': GIT_STATUS,
  'git log': GIT_LOG,
  'git log --oneline': GIT_LOG,
  'tmux ls': TMUX_LS,
  help: [
    'A pretend shell: nothing here runs. Try ls, git status, git log or tmux ls.',
  ],
};

export const ZSH_HISTORY: readonly ZshEntry[] = [
  {
    cmd: 'npm run bench',
    ok: true,
    out: [
      '',
      '> atlas@0.9.0 bench',
      '> node --cpu-prof --cpu-prof-name=atlas.cpuprofile scripts/bench.mjs',
      '',
      [['  render 10k rows   '], ['142.8 ms', 'bold'], ['  ±2.1%', 'dim']],
      [['  filter (warm)       '], ['3.9 ms', 'bold'], ['  ±0.4%', 'dim']],
      [['  wrote atlas.cpuprofile', 'green']],
    ],
  },
  { cmd: 'tmux ls', ok: true, out: TMUX_LS },
];

/** Runs one line; null means `clear`. */
export function runZsh(input: string): ZshEntry | null {
  const cmd = input.trim().replace(/\s+/g, ' ');
  if (cmd === 'clear') return null;
  if (cmd === '') return { cmd: input, out: [], ok: true };
  if (cmd.startsWith('echo ')) {
    return { cmd: input, out: [cmd.slice(5)], ok: true };
  }
  const out = COMMANDS[cmd];
  if (out) return { cmd: input, out, ok: true };
  const name = cmd.split(' ')[0];
  return { cmd: input, out: [`zsh: command not found: ${name}`], ok: false };
}
