/**
 * The remote twin of `tmux-launch.ts`'s `prepareTmuxSession`: the same
 * `TmuxLaunchPlan`, interpreted into the same argv (via the exported
 * builders `tmux-launch.ts` shares for exactly this purpose), executed
 * through a `MachineExecutor` instead of a local fork (decisions.md D5).
 *
 * Only `create` and a plain `attach` (no native-incarnation guard) are
 * supported remotely this phase — `TmuxSessionIncarnation` is
 * server-scoped (`tmux-snapshot.ts`) and a remote transport has no
 * incarnation notion of its own yet. `restart`/`replace` and a guarded
 * `attach` throw rather than silently falling back to an unguarded
 * operation.
 */
import type { SessionSpec } from '@n10/terminal';
import {
  commandArgs,
  optionCommands,
  sessionEnvFlags,
  type TmuxLaunchPlan,
} from './tmux-launch.js';
import { sanitizeTmuxSessionName } from './sanitize-tmux-session-name.js';
import { setOptionArgv, type MachineExecutor } from './tmux-cli.js';
import {
  isDuplicateSession,
  runTmuxWith,
  tmuxFreeSessionNameWith,
  tmuxHasSessionWith,
  tmuxKillSessionWith,
  tmuxNewSessionDetachedWith,
  tmuxShowOptionWith,
} from './tmux-cli-remote.js';

function checkedRemote(
  result: { exitCode: number; stderr: string },
  operation: string
): void {
  if (result.exitCode !== 0)
    throw new Error(`tmux ${operation} failed: ${result.stderr.trim()}`);
}

async function resolvedCommandArgs(
  executor: MachineExecutor,
  name: string,
  spec: SessionSpec,
  replacePlaceholder: boolean
): Promise<string[]> {
  // Lazy, exactly like the local path: only fetch the configured
  // login shell when there is no explicit command to respawn.
  const defaultShell = spec.cmd
    ? undefined
    : await tmuxShowOptionWith(executor, name, 'default-shell');
  return commandArgs(name, spec, replacePlaceholder, defaultShell);
}

async function createRemote(
  executor: MachineExecutor,
  spec: SessionSpec,
  plan: Extract<TmuxLaunchPlan, { mode: 'create' }>
): Promise<string> {
  const label = sanitizeTmuxSessionName(plan.label);
  const isTaken = async (candidate: string): Promise<boolean> =>
    !!plan.excludedNames?.includes(candidate) ||
    (await tmuxHasSessionWith(executor, candidate));
  const name = await tmuxFreeSessionNameWith(executor, label, isTaken);
  const result = await tmuxNewSessionDetachedWith(executor, name, {
    cwd: spec.cwd,
    cols: spec.cols,
    rows: spec.rows,
    flags: sessionEnvFlags(spec),
    command: ['--', '/bin/sh', '-c', 'exec sleep 86400'],
  });
  if (isDuplicateSession(result))
    throw new Error(
      `session name "${name}" was taken between probe and create`
    );
  checkedRemote(result, `new-session -s ${name}`);
  try {
    const commands = [
      ...optionCommands(name, plan.tags, plan.retainOnExit),
      await resolvedCommandArgs(executor, name, spec, true),
    ];
    const [first, ...following] = commands;
    checkedRemote(
      await runTmuxWith(executor, first!, following),
      'session setup'
    );
    return name;
  } catch (error) {
    await tmuxKillSessionWith(executor, name);
    throw error;
  }
}

export async function prepareRemoteTmuxSession(
  executor: MachineExecutor,
  spec: SessionSpec,
  plan: TmuxLaunchPlan
): Promise<string> {
  if (plan.mode === 'create') return createRemote(executor, spec, plan);
  if (plan.mode === 'attach' && !plan.expected) {
    checkedRemote(
      await runTmuxWith(executor, setOptionArgv(plan.target, 'status', 'off')),
      'set-option status'
    );
    return plan.target;
  }
  throw new Error(
    `remote sessions do not support "${plan.mode}" yet — only create and a plain attach run on a remote machine`
  );
}
