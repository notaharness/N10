import { runTmux, runTmuxAsync, type TmuxRunResult } from './tmux-cli.js';

export interface TmuxPaneState {
  paneDead: boolean;
  exitCode?: number;
  exitSignal?: number;
}

function optionalNumber(value: string | undefined): number | undefined {
  return value && /^\d+$/.test(value) ? Number(value) : undefined;
}

function parsePaneState(fields: string[]): TmuxPaneState {
  const exitCode = optionalNumber(fields[1]);
  const exitSignal = optionalNumber(fields[2]);
  return {
    paneDead: fields[0] === '1',
    ...(exitCode == null ? {} : { exitCode }),
    ...(exitSignal == null ? {} : { exitSignal }),
  };
}

/** Shared by the sync and async pane-state readers. */
export function paneStateArgs(name: string): string[] {
  return [
    '-u',
    'display-message',
    '-p',
    '-t',
    `=${name}:`,
    '#{pane_id}\t#{pane_dead}\t#{pane_dead_status}\t#{pane_dead_signal}',
  ];
}

/** Shared with the async poller: both read the same fixed columns. */
export function parsePaneStateResult(
  result: TmuxRunResult
): TmuxPaneState | null {
  const fields = result.stdout.trimEnd().split('\t');
  // display-message may succeed with empty output for a vanished target.
  // Require an actual pane identity and explicit native liveness state.
  if (
    result.exitCode !== 0 ||
    !/^%\d+$/.test(fields[0] ?? '') ||
    !['0', '1'].includes(fields[1] ?? '')
  )
    return null;
  return parsePaneState(fields.slice(1));
}

/** Null means the session/pane no longer exists. */
export function tmuxPaneState(name: string): TmuxPaneState | null {
  return parsePaneStateResult(runTmux(paneStateArgs(name)));
}

/** Outcome of an async pane-state read, for the backend's poller. A
 *  non-zero exit or spawn error (`EAGAIN`/`EMFILE` on fork, `ENOENT`, the
 *  5s timeout kill — see `runTmuxAsync`) means n10 could not talk to
 *  tmux at all: `'failed'`. That is distinct from tmux itself answering
 *  with an empty, unparseable pane for a target that genuinely no longer
 *  exists: `'gone'`. Only `'gone'` means the hosted process is gone; a
 *  `'failed'` read says nothing about the pane and must not be treated
 *  as an exit. */
export type TmuxPaneRead =
  | { status: 'ok'; state: TmuxPaneState }
  | { status: 'gone' }
  | { status: 'failed' };

/** tmux's own wording for "this server has no sessions left" — the same
 *  condition {@link tmuxListSessionsDetailed} treats as an empty list, not
 *  a failure. Killing a session's last sibling on a server tears the
 *  server down with it, so the target being gone can surface either as
 *  this non-zero exit or as the exit-0/empty-output case below,
 *  depending on whether other sessions kept the server alive. */
const NO_SERVER = /no server running/;

function classifyPaneStateResult(result: TmuxRunResult): TmuxPaneRead {
  if (result.exitCode !== 0)
    return NO_SERVER.test(result.stderr)
      ? { status: 'gone' }
      : { status: 'failed' };
  const fields = result.stdout.trimEnd().split('\t');
  // display-message may succeed with empty output for a vanished target.
  // Require an actual pane identity and explicit native liveness state.
  if (!/^%\d+$/.test(fields[0] ?? '') || !['0', '1'].includes(fields[1] ?? ''))
    return { status: 'gone' };
  return { status: 'ok', state: parsePaneState(fields.slice(1)) };
}

/** Async twin of {@link tmuxPaneState}, for the backend's periodic poll: a
 *  synchronous `execFileSync` there blocks Ink's render loop and Electron's
 *  main process every 500ms per session. Unlike the sync reader, this
 *  distinguishes a read failure from a genuinely vanished target — see
 *  {@link TmuxPaneRead} — because the poller must not conclude the hosted
 *  process exited merely because n10 momentarily could not fork tmux. */
export async function tmuxPaneStateAsync(name: string): Promise<TmuxPaneRead> {
  return classifyPaneStateResult(await runTmuxAsync(paneStateArgs(name)));
}

const UTF8 = '-u';

/** One live session: its name and the directory it was started in. */
export interface TmuxSessionInfo {
  name: string;
  /** `#{session_created}` — seconds since the epoch, tmux's own clock.
   *  Orders two sessions that claim the same identity: the older one
   *  is the one that was there first. `0` when tmux reports nothing
   *  parseable. */
  created: number;
  /** Active pane lifecycle, independent of whether clients are attached. */
  paneDead: boolean;
  exitCode?: number;
  exitSignal?: number;
  /** `#{session_path}` — the `-c` directory `new-session` was given,
   *  or the server's cwd when it was not. Empty when tmux reports
   *  nothing. */
  path: string;
  /** The session user options {@link tmuxListSessionsDetailed} was
   *  asked for, by name, for those that have a value. An unset option
   *  expands to nothing in a format string, which is indistinguishable
   *  from one set to `''`, so both are left out. Absent when no option
   *  names were asked for. */
  options?: Record<string, string>;
}

export function sessionColumns(options: readonly string[]): string[] {
  return [
    '#{session_name}',
    '#{session_created}',
    '#{pane_dead}',
    '#{pane_dead_status}',
    '#{pane_dead_signal}',
    ...options.map((option) => `#{${option}}`),
    '#{session_path}',
  ];
}

/** Every session the server currently holds, with the directory each
 *  was started in, or `[]` when there is no server at all
 *  (`list-sessions` exits non-zero with "no server running").
 *
 *  One fork regardless of how many sessions exist, which is the whole
 *  reason it exists next to {@link tmuxHasSession}: a caller checking
 *  N candidates pays N forks through `has-session` and one through
 *  this. `#{session_name}` is the oldest of tmux's format variables
 *  and all requested native fields are available in the supported tmux versions.
 *
 *  `options` names session user options (`@key`) to read in the same
 *  fork; each becomes a `#{@key}` column. Tab-separated with the name
 *  first, the creation time and pane lifecycle next, then options and the path
 *  last: a session name never carries a tab (the sanitizer only
 *  rewrites `.` and `:`, and nothing composes one with a tab), an
 *  option value is the caller's to keep tab-free, and the path may
 *  contain anything — so the first columns are split off one tab at a
 *  time and whatever remains, tabs included, is the path. */
/** Pure argv builder, shared with the remote executor path (D3's
 *  per-machine poller): a machine change must not change what is
 *  asked of tmux. */
export function listSessionsArgv(options: readonly string[] = []): string[] {
  return [UTF8, 'list-sessions', '-F', sessionColumns(options).join('\t')];
}

export function tmuxListSessionsDetailed(
  options: readonly string[] = []
): TmuxSessionInfo[] {
  const { stdout, exitCode } = runTmux(listSessionsArgv(options));
  if (exitCode !== 0) return [];
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => parseSessionLine(line, options));
}

/** Native columns before the optional user tags and final path. */
const FIXED_COLUMNS = 5;

/** One `list-sessions` line back into a session: the leading columns
 *  are the name, the creation time and the asked-for options; the
 *  remainder is the path. */
export function parseSessionLine(
  line: string,
  options: readonly string[]
): TmuxSessionInfo {
  const leading = FIXED_COLUMNS + options.length;
  const fields = line.split('\t', leading);
  const rest = fields.join('\t').length;
  const name = fields[0] ?? line;
  const created = Number.parseInt(fields[1] ?? '', 10) || 0;
  const path = fields.length >= leading ? line.slice(rest + 1) : '';
  const state = parsePaneState(fields.slice(2, 5));
  if (options.length === 0) return { name, created, path, ...state };
  const values: Record<string, string> = {};
  options.forEach((option, i) => {
    const value = fields[i + FIXED_COLUMNS];
    if (value) values[option] = value;
  });
  return { name, created, path, ...state, options: values };
}
