import type { Program, Tty } from '../host/sessions.js';
import { paint, type Span } from './ansi.js';

/**
 * A zsh with oh-my-zsh's default robbyrussell prompt, in whatever
 * directory the tab was opened on. It does its own line editing, as the
 * PTY's line discipline would, and answers a handful of commands from a
 * table (richest in the n10 checkout); anything else is "command not
 * found". Nothing executes.
 */
const TMUX_LS = [
  'n10-feat-fleet-sidebar: 1 windows (created Sat Sep 26 09:12:04 2026)',
  'n10-fix-tab-branch-switch: 1 windows (created Sat Sep 26 08:47:31 2026)',
  'n10-shell: 1 windows (created Sat Sep 26 09:40:51 2026) (attached)',
];

const COMMANDS: Record<string, readonly (string | Span[])[]> = {
  ls: [
    'AGENTS.md  CLAUDE.md  LICENSE  README.md  apps  docs  eslint.config.mjs  libs  nx.json  package.json  tools',
  ],
  whoami: ['you'],
  'tmux ls': TMUX_LS,
  'git status': [
    'On branch master',
    "Your branch is up to date with 'origin/master'.",
    '',
    'nothing to commit, working tree clean',
  ],
  'git log --oneline': [
    [
      ['82fa6e86', ['yellow']],
      [
        ' docs(website): list Gemini, Copilot and OpenCode as Orchestra players',
      ],
    ],
    [
      ['3888fdb4', ['yellow']],
      [' fix(cli): list the Azure DevOps token scopes n10 uses in onboarding'],
    ],
    [
      ['6d7807cf', ['yellow']],
      [
        ' docs(website): tighten the Worktree Path, provider fields and rename wording',
      ],
    ],
  ],
  'git worktree list': [
    '/home/you/code/n10                                          82fa6e86 [master]',
    '/home/you/code/n10/.claude/worktrees/docs-roadmap           82fa6e86 [docs/roadmap]',
    '/home/you/code/n10/.claude/worktrees/feat-fleet-sidebar     aaf0a2be [feat/fleet-sidebar]',
    '/home/you/code/n10/.claude/worktrees/fix-tab-branch-switch  905bbcb2 [fix/tab-branch-switch]',
  ],
  help: [
    'A pretend shell: nothing here runs. Try ls, git status, git log --oneline, git worktree list or tmux ls.',
  ],
};
COMMANDS['git log'] = COMMANDS['git log --oneline'] ?? [];

/** Commands whose answer does not depend on the directory. */
const ANYWHERE = new Set(['whoami', 'tmux ls', 'help']);

const HISTORY: readonly { cmd: string; out: readonly (string | Span[])[] }[] = [
  {
    cmd: 'npx nx affected -t lint --base=master',
    out: [
      '',
      [
        [' NX ', ['reverse', 'bold']],
        ['   Running target ', []],
        ['lint', ['bold']],
        [' for 3 projects', []],
      ],
      '',
      [
        ['   ✔', ['green']],
        ['  nx run core:lint', ['gray']],
      ],
      [
        ['   ✔', ['green']],
        ['  nx run app-core:lint', ['gray']],
      ],
      [
        ['   ✔', ['green']],
        ['  nx run desktop:lint', ['gray']],
      ],
      '',
      [
        [' NX ', ['reverse', 'bold', 'green']],
        ['   Successfully ran target ', ['green']],
        ['lint', ['bold', 'green']],
        [' for 3 projects', ['green']],
      ],
    ],
  },
  { cmd: 'tmux ls', out: TMUX_LS },
];

function prompt(ok: boolean, dir: string, branch?: string): string {
  const git: Span[] = branch
    ? [
        ['git:(', ['bold', 'blue']],
        [branch, ['red']],
        [')', ['bold', 'blue']],
        [' '],
      ]
    : [];
  return paint([
    ['➜', ['bold', ok ? 'green' : 'red']],
    ['  '],
    [dir, ['cyan']],
    [' '],
    ...git,
  ]);
}

const lines = (out: readonly (string | Span[])[]) =>
  out.map((l) => (typeof l === 'string' ? l : paint(l))).join('\r\n');

export class Zsh implements Program {
  private tty!: Tty;
  private line = '';
  private ok = true;
  private readonly dir: string;
  private readonly home: boolean;

  /** `branch` is set when `cwd` is a checkout. */
  constructor(private readonly cwd: string, private readonly branch?: string) {
    this.dir = cwd.split('/').pop() || '/';
    this.home = cwd.endsWith('/code/n10');
  }

  private prompt(): string {
    return prompt(this.ok, this.dir, this.branch);
  }

  start(tty: Tty): void {
    this.tty = tty;
    let out = '';
    for (const entry of this.home ? HISTORY : []) {
      out += `${this.prompt()}${entry.cmd}\r\n${lines(entry.out)}\r\n`;
    }
    tty.write(out + this.prompt());
  }

  /** What `cmd` prints here, or undefined for "command not found".
   *  The table describes the n10 checkout; elsewhere only what holds
   *  for any directory answers. */
  private answer(cmd: string): readonly (string | Span[])[] | undefined {
    if (cmd.startsWith('echo ')) return [cmd.slice(5)];
    if (cmd === 'pwd') return [this.cwd];
    if (this.home || ANYWHERE.has(cmd)) return COMMANDS[cmd];
    if (!cmd.startsWith('git ')) return undefined;
    if (!this.branch) {
      return [
        'fatal: not a git repository (or any of the parent directories): .git',
      ];
    }
    return cmd === 'git status'
      ? [`On branch ${this.branch}`, 'nothing to commit, working tree clean']
      : undefined;
  }

  input(data: string): void {
    for (const key of data.startsWith('\x1b') ? [data] : [...data])
      this.key(key);
  }

  private key(key: string): void {
    if (key === '\r') return this.run();
    if (key === '\x7f') {
      if (!this.line) return;
      this.line = [...this.line].slice(0, -1).join('');
      return this.tty.write('\b \b');
    }
    if (key === '\x03') {
      this.line = '';
      return this.tty.write(`^C\r\n${this.prompt()}`);
    }
    if (key === '\x0c') return this.clear();
    if (key < ' ' || key.startsWith('\x1b')) return;
    this.line += key;
    this.tty.write(key);
  }

  private clear(): void {
    this.tty.write(`\x1b[2J\x1b[H${this.prompt()}${this.line}`);
  }

  private run(): void {
    const cmd = this.line.trim().replace(/\s+/g, ' ');
    this.line = '';
    if (cmd === 'clear') {
      this.tty.write('\r\n');
      return this.clear();
    }
    const out = this.answer(cmd);
    if (cmd === '') this.ok = true;
    else this.ok = Boolean(out);
    const text = !cmd
      ? ''
      : out
      ? lines(out)
      : `zsh: command not found: ${cmd.split(' ')[0] ?? ''}`;
    this.tty.write(`\r\n${text ? `${text}\r\n` : ''}${this.prompt()}`);
  }
}
