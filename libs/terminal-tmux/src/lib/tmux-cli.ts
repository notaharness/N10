import { execFile, execFileSync } from 'node:child_process';
import { tmuxListSessionsDetailed } from './tmux-state.js';

/**
 * The seam a remote machine is executed through (decisions.md D5): the
 * same argv this library would run locally, handed to something that
 * runs it somewhere else. Structurally identical to `@n10/core`'s
 * `MachineExecutor` — declared locally, not imported, because core
 * depends on this package and not the other way around; a concrete
 * executor built anywhere satisfies both by shape.
 */
export interface MachineExecutor {
  run(
    argv: string[],
    opts?: { cwd?: string; env?: Record<string, string>; stdin?: string }
  ): Promise<{ stdout: string; stderr: string; code: number }>;
}
export {
  tmuxListSessionsDetailed,
  tmuxPaneState,
  tmuxPaneStateAsync,
  type TmuxPaneState,
  type TmuxPaneRead,
  type TmuxSessionInfo,
} from './tmux-state.js';

/** Result of running a tmux subcommand. */
export interface TmuxRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** tmux interprets a trailing semicolon as a command boundary even when
 *  invoked without a shell. Escape literal data before inserting the
 *  boundaries between chained commands, shared by the sync and async runners. */
/** Exported so the remote executor path (`remote-backend.ts`) chains
 *  commands into exactly the same one-argv-per-atomic-operation form a
 *  local invocation uses — a machine change must not change what is
 *  asked of tmux, only where it runs. */
export function buildTmuxArgv(args: string[], following: string[][]): string[] {
  const commands = [args, ...following].map((command) =>
    command.map((argument) => argument.replace(/;$/, '\\;'))
  );
  return commands.flatMap((command, index) =>
    index === 0 ? command : [';', ...command]
  );
}

/** Synchronous run of a tmux subcommand. Tmux's control commands
 *  (new-session, kill-session, has-session, -V) all complete in
 *  milliseconds, so blocking is fine — and using execFileSync matches
 *  the pattern used elsewhere in the workspace
 *  (libs/vcs/core/src/lib/config-store.ts) which keeps mocking
 *  straightforward. */
export function runTmux(
  args: string[],
  following: string[][] = []
): TmuxRunResult {
  const argv = buildTmuxArgv(args, following);
  try {
    const stdout = execFileSync('tmux', argv, {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (err) {
    const e = err as Error & {
      status?: number;
      stdout?: string | Buffer;
      stderr?: string | Buffer;
      code?: string;
    };
    return {
      stdout:
        typeof e.stdout === 'string' ? e.stdout : e.stdout?.toString() ?? '',
      stderr:
        typeof e.stderr === 'string' ? e.stderr : e.stderr?.toString() ?? '',
      exitCode: typeof e.status === 'number' ? e.status : 1,
    };
  }
}

/** Async run of a tmux subcommand via `execFile`, so a poller on a tight
 *  interval (the backend's pane-state inspect) never blocks the caller's
 *  event loop — Ink's render loop or Electron's main process. Command
 *  construction mirrors {@link runTmux} exactly; only the exec call differs. */
export function runTmuxAsync(
  args: string[],
  following: string[][] = []
): Promise<TmuxRunResult> {
  const argv = buildTmuxArgv(args, following);
  return new Promise((resolve) => {
    execFile(
      'tmux',
      argv,
      { encoding: 'utf8', timeout: 5000 },
      (err, stdout, stderr) => {
        if (!err) {
          resolve({ stdout, stderr: '', exitCode: 0 });
          return;
        }
        const e = err as NodeJS.ErrnoException & { code?: number | string };
        resolve({
          stdout: stdout ?? '',
          stderr: stderr ?? '',
          exitCode: typeof e.code === 'number' ? e.code : 1,
        });
      }
    );
  });
}

/** `tmux -V` → "tmux 3.4". Throws if tmux is unavailable (ENOENT). */
export function tmuxVersion(): string {
  return execFileSync('tmux', ['-V'], { encoding: 'utf8' }).trim();
}

/** Pure argv builder, shared with the remote executor path so a
 *  machine change can never change what is asked of tmux. */
export function killSessionArgv(name: string): string[] {
  return ['kill-session', '-t', exactSession(name)];
}

/** Hard teardown — kills exactly the named tmux session and all its
 *  panes. Exact, because a prefix match would take out `name-2` once
 *  `name` itself is gone. */
export function tmuxKillSession(name: string): TmuxRunResult {
  return runTmux(killSessionArgv(name));
}

/** Pure argv builder, shared with the remote executor path. */
export function hasSessionArgv(name: string): string[] {
  return ['has-session', '-t', exactSession(name)];
}

/** Returns true if a session with this name exists. Exact: a bare
 *  `-t name` would also answer for `name-2` while `name` is gone. */
export function tmuxHasSession(name: string): boolean {
  return runTmux(hasSessionArgv(name)).exitCode === 0;
}

/** What `new-session -d` needs besides the name. */
export interface TmuxNewSessionOptions {
  cwd: string;
  cols: number;
  rows: number;
  /** Already-formed `new-session` flags to splice in before the
   *  command — `-e KEY=value` pairs, typically. */
  flags?: readonly string[];
  /** The command half of the argv (`--`, program, args…), or `[]` for
   *  tmux's own `default-shell`. */
  command?: readonly string[];
}

/** Create a session without attaching any client to it (`new-session
 *  -d`). The session exists when this returns, so a caller can write
 *  options on it before anything else can observe it; the client that
 *  will drive it attaches afterwards with {@link tmuxAttachArgs}. A
 *  non-zero exit is returned, not thrown — a caller racing another
 *  creator inspects {@link isDuplicateSession} and tries another name. */
/** Pure argv builder, shared with the remote executor path. */
export function newSessionDetachedArgv(
  name: string,
  opts: TmuxNewSessionOptions
): string[] {
  return [
    'new-session',
    '-d',
    '-s',
    name,
    '-c',
    opts.cwd,
    '-x',
    String(opts.cols),
    '-y',
    String(opts.rows),
    ...(opts.flags ?? []),
    ...(opts.command ?? []),
  ];
}

export function tmuxNewSessionDetached(
  name: string,
  opts: TmuxNewSessionOptions
): TmuxRunResult {
  return runTmux(newSessionDetachedArgv(name, opts));
}

/** Whether `new-session` failed because the name was taken in the
 *  moment between a free-name probe and the create — the one failure a
 *  caller answers by trying the next candidate rather than giving up. */
export function isDuplicateSession(result: TmuxRunResult): boolean {
  return result.exitCode !== 0 && /duplicate session/.test(result.stderr);
}

/** The argv of a tmux client that attaches to exactly this session and
 *  nothing else — `=name:` refuses the prefix match a bare `-t` falls
 *  back to (see {@link exactSession}). */
export function tmuxAttachArgs(name: string): string[] {
  return ['attach-session', '-t', exactSession(name)];
}

/** The names a caller tries, in order, for a preferred one: the name
 *  itself, then `name-2`, `name-3`, … A suffix is chosen at creation
 *  only; nothing reconstructs it later, because the name is a label
 *  and whatever identifies the session lives elsewhere. */
export function* sessionNameCandidates(preferred: string): Generator<string> {
  yield preferred;
  for (let n = 2; ; n += 1) yield `${preferred}-${n}`;
}

/** How many candidates a free-name probe tries before giving up: far
 *  more sessions than one server ever holds, but finite, so a probe
 *  whose `isTaken` never says no cannot spin forever. */
const MAX_NAME_CANDIDATES = 10_000;

/** The first of {@link sessionNameCandidates} that is not taken —
 *  by default, not held by the server (`has-session`, one fork per
 *  candidate; the preferred name is usually free, so usually one).
 *  `isTaken` lets a caller fold in names it holds itself. */
export function tmuxFreeSessionName(
  preferred: string,
  isTaken: (name: string) => boolean = tmuxHasSession
): string {
  let tried = 0;
  for (const candidate of sessionNameCandidates(preferred)) {
    if (!isTaken(candidate)) return candidate;
    if ((tried += 1) >= MAX_NAME_CANDIDATES) break;
  }
  throw new Error(`no free tmux session name for ${preferred}`);
}

/** The `-t` argument that names exactly this session. A bare name is
 *  matched by prefix when no session has it exactly, so with `feature`
 *  and `feature-2` both live, `-t feature` after `feature` is gone
 *  quietly lands on the other one; `=name:` refuses anything but an
 *  exact match. The `=` form is supported by all tmux versions this backend accepts. */
export function exactSession(name: string): string {
  return `=${name}:`;
}

/** Set a session option — a built-in one (`status off`) or a user
 *  option (`@key value`), which is how a caller attaches metadata to
 *  the session for other clients of the server to read. */
/** Pure argv builder, shared with the remote executor path. `value ===
 *  null` unsets the option (`-u`), matching `tmux-launch.ts`'s own
 *  option commands. */
export function setOptionArgv(
  name: string,
  option: string,
  value: string | null
): string[] {
  return [
    'set-option',
    ...(value === null ? ['-u'] : []),
    '-t',
    exactSession(name),
    option,
    ...(value === null ? [] : [value]),
  ];
}

export function tmuxSetOption(
  name: string,
  option: string,
  value: string
): TmuxRunResult {
  return runTmux(setOptionArgv(name, option, value));
}

/** tmux decides from `LANG`/`LC_CTYPE`/`LC_ALL` whether its client is
 *  UTF-8 and, when it is not, rewrites control characters in what it
 *  prints — the tab between listing columns, a newline in a value — to
 *  `_`. `-u` declares the client UTF-8 whatever the locale says, so
 *  every command whose output is parsed carries it. */
const UTF8 = '-u';

/** The value of one session option, or `''` when it is unset (`-q`
 *  makes that a silent, zero exit), the session is not there, or
 *  there is no server. Only the line terminator is dropped: the value
 *  is the caller's, spaces and all. */
/** Pure argv builder, shared with the remote executor path. */
export function showOptionArgv(name: string, option: string): string[] {
  return [UTF8, 'show-options', '-qv', '-t', exactSession(name), option];
}

export function tmuxShowOption(name: string, option: string): string {
  const { stdout, exitCode } = runTmux(showOptionArgv(name, option));
  return exitCode === 0 ? stdout.replace(/\r?\n$/, '') : '';
}

/** Every session name the server currently holds — see
 *  {@link tmuxListSessionsDetailed}, which this reads through so a
 *  caller wanting only names pays the same single fork. */
export function tmuxListSessions(): string[] {
  return tmuxListSessionsDetailed().map((s) => s.name);
}

/** Capture the retained screen and scrollback when no client saw the process exit. */
/** Pure argv builder, shared with the remote executor path. */
export function capturePaneArgv(name: string): string[] {
  return ['capture-pane', '-p', '-e', '-S', '-', '-t', exactSession(name)];
}

export function tmuxCapturePane(name: string): string | null {
  const result = runTmux(capturePaneArgv(name));
  return result.exitCode === 0 ? result.stdout : null;
}
