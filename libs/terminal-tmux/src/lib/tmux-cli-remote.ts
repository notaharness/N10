/**
 * Async, `MachineExecutor`-driven twins of the synchronous primitives in
 * `tmux-cli.ts`/`tmux-state.ts`. A remote machine cannot be talked to
 * synchronously, so these exist instead of threading an executor into
 * the sync functions themselves — but every argv they send is built by
 * the exact same exported builders the local path uses
 * (`buildTmuxArgv`, `newSessionDetachedArgv`, `killSessionArgv`, …), so
 * a machine change can never change what is asked of tmux (decisions.md
 * D5).
 */
import {
  buildTmuxArgv,
  capturePaneArgv,
  hasSessionArgv,
  isDuplicateSession,
  killSessionArgv,
  newSessionDetachedArgv,
  sessionNameCandidates,
  showOptionArgv,
  type MachineExecutor,
  type TmuxNewSessionOptions,
  type TmuxRunResult,
} from './tmux-cli.js';
import {
  listSessionsArgv,
  parseSessionLine,
  type TmuxSessionInfo,
} from './tmux-state.js';

function toTmuxRunResult(result: {
  stdout: string;
  stderr: string;
  code: number;
}): TmuxRunResult {
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.code,
  };
}

/** Runs one chained command queue (`buildTmuxArgv`'s `;`-joined form,
 *  exactly as a local `runTmux` would) through a remote executor. */
export async function runTmuxWith(
  executor: MachineExecutor,
  args: string[],
  following: string[][] = []
): Promise<TmuxRunResult> {
  const argv = buildTmuxArgv(args, following);
  const result = await executor.run(['tmux', ...argv]);
  return toTmuxRunResult(result);
}

export async function tmuxHasSessionWith(
  executor: MachineExecutor,
  name: string
): Promise<boolean> {
  return (await runTmuxWith(executor, hasSessionArgv(name))).exitCode === 0;
}

export async function tmuxKillSessionWith(
  executor: MachineExecutor,
  name: string
): Promise<TmuxRunResult> {
  return runTmuxWith(executor, killSessionArgv(name));
}

export async function tmuxNewSessionDetachedWith(
  executor: MachineExecutor,
  name: string,
  opts: TmuxNewSessionOptions
): Promise<TmuxRunResult> {
  return runTmuxWith(executor, newSessionDetachedArgv(name, opts));
}

export async function tmuxShowOptionWith(
  executor: MachineExecutor,
  name: string,
  option: string
): Promise<string> {
  const result = await runTmuxWith(executor, showOptionArgv(name, option));
  return result.exitCode === 0 ? result.stdout.replace(/\r?\n$/, '') : '';
}

export async function tmuxCapturePaneWith(
  executor: MachineExecutor,
  name: string
): Promise<string | null> {
  const result = await runTmuxWith(executor, capturePaneArgv(name));
  return result.exitCode === 0 ? result.stdout : null;
}

/**
 * A non-zero exit must never read the same as an empty, successful
 * listing — tmux missing on the remote, a socket permission error, or
 * an `exec` handler returning non-zero all say "this call could not
 * run", not "no sessions". `RemoteSessionPoller` relies on this: it
 * only routes a *thrown* error to `onUnreachable`, matching the local
 * backend's own rule (`tmux-backend.ts`: "A failed read says nothing
 * about the pane"). Swallowing the distinction here (returning `[]`
 * either way) is what let a machine-side tmux failure render as every
 * session on it having exited, at exit code 0 (finding 3).
 */
export async function tmuxListSessionsDetailedWith(
  executor: MachineExecutor,
  options: readonly string[] = []
): Promise<TmuxSessionInfo[]> {
  const result = await runTmuxWith(executor, listSessionsArgv(options));
  if (result.exitCode !== 0)
    throw new Error(
      `tmux list-sessions failed (exit ${result.exitCode}): ${
        result.stderr || result.stdout || 'no output'
      }`
    );
  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => parseSessionLine(line, options));
}

/** Async twin of `tmuxFreeSessionName`: probes candidates one at a
 *  time (a remote `has-session` is a network round trip, so this is
 *  the one place remote creation is slower than local, not less
 *  correct). Same bound on attempts as the local prober. */
export async function tmuxFreeSessionNameWith(
  executor: MachineExecutor,
  preferred: string,
  isTaken: (name: string) => Promise<boolean> = (name) =>
    tmuxHasSessionWith(executor, name)
): Promise<string> {
  let tried = 0;
  for (const candidate of sessionNameCandidates(preferred)) {
    if (!(await isTaken(candidate))) return candidate;
    if ((tried += 1) >= 10_000) break;
  }
  throw new Error(`no free tmux session name for ${preferred}`);
}

export { isDuplicateSession };
