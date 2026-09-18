import {
  runGuardedTmuxCommands,
  type TmuxSessionIncarnation,
} from './tmux-snapshot.js';
import type { SessionSpec } from '@n10/terminal';
import { sanitizeTmuxSessionName } from './sanitize-tmux-session-name.js';
import {
  isDuplicateSession,
  sessionNameCandidates,
  setOptionArgv,
  tmuxHasSession,
  tmuxKillSession,
  tmuxNewSessionDetached,
  tmuxSetOption,
  tmuxShowOption,
  runTmux,
  tmuxPaneState,
  type TmuxRunResult,
} from './tmux-cli.js';

/** The caller decides identity and intent; this library performs transport operations. */
export type TmuxLaunchPlan =
  | {
      mode: 'create';
      label: string;
      tags: Record<string, string>;
      retainOnExit?: boolean;
      excludedNames?: readonly string[];
    }
  | {
      mode: 'attach';
      target: string;
      expected?: TmuxSessionIncarnation;
      expectedTags?: Record<string, string>;
    }
  | {
      mode: 'restart';
      target: string;
      expected?: TmuxSessionIncarnation;
      expectedTags?: Record<string, string>;
      tags?: Record<string, string | null>;
      retainOnExit?: boolean;
    }
  | {
      mode: 'replace';
      target: string;
      expected: TmuxSessionIncarnation;
      expectedTags?: Record<string, string>;
      tags?: Record<string, string | null>;
      retainOnExit?: boolean;
    };

function checked(result: TmuxRunResult, operation: string): void {
  if (result.exitCode !== 0)
    throw new Error(`tmux ${operation} failed: ${result.stderr.trim()}`);
}

/** The server retains its original environment, so pin launch-specific
 *  additions. Exported so the remote executor path builds identical
 *  `-e` flags for a `new-session`/`respawn-pane` (decisions.md D5: the
 *  same plan, the same argv, wherever it runs). */
export function sessionEnvFlags(spec: SessionSpec): string[] {
  const vars = new Map<string, string>();
  for (const key of ['PATH', 'HOME']) {
    const value = spec.env?.[key] ?? process.env[key];
    if (value) vars.set(key, value);
  }
  for (const [key, value] of Object.entries(spec.envAdditions ?? {})) {
    if (value != null) vars.set(key, value);
  }
  return [...vars].flatMap(([key, value]) => ['-e', `${key}=${value}`]);
}

/**
 * Exported for the remote executor path — see {@link sessionEnvFlags}.
 * `defaultShell` is resolved by the caller (locally via the sync
 * `tmuxShowOption` when omitted, remotely via an already-awaited
 * `show-options` read) so this stays a pure argv builder — the same
 * plan produces the same argv wherever it runs.
 */
export function commandArgs(
  name: string,
  spec: SessionSpec,
  replacePlaceholder: boolean,
  defaultShell?: string
): string[] {
  // No command to respawn-pane repeats the placeholder. Explicitly select
  // the configured login shell for an ordinary terminal instead. Lazy:
  // a spec with a command must never pay for a `show-options` fork it
  // does not need, locally or remotely.
  const command = spec.cmd
    ? [spec.cmd, ...spec.args]
    : [
        (defaultShell ?? tmuxShowOption(name, 'default-shell')) || '/bin/sh',
        '-l',
      ];
  return [
    'respawn-pane',
    ...(replacePlaceholder ? ['-k'] : []),
    '-t',
    `=${name}:`,
    '-c',
    spec.cwd,
    ...sessionEnvFlags(spec),
    '--',
    ...command,
  ];
}

/** Exported for the remote executor path — see {@link sessionEnvFlags}. */
export function optionCommands(
  name: string,
  tags: Record<string, string | null> = {},
  retain = false
): string[][] {
  const options = {
    ...tags,
    'remain-on-exit': retain ? 'on' : 'off',
    status: 'off',
  };
  return Object.entries(options).map(([key, value]) =>
    setOptionArgv(name, key, value)
  );
}

function runCommands(commands: string[][]): void {
  const [first, ...following] = commands;
  checked(runTmux(first, following), 'session setup');
}

function create(
  spec: SessionSpec,
  plan: Extract<TmuxLaunchPlan, { mode: 'create' }>
): string {
  const label = sanitizeTmuxSessionName(plan.label);
  let attempts = 0;
  for (const name of sessionNameCandidates(label)) {
    if (++attempts > 10_000) break;
    if (plan.excludedNames?.includes(name) || tmuxHasSession(name)) continue;
    // A long-lived placeholder keeps the session available while options are
    // written. The real command cannot exit before its metadata is installed.
    const result = tmuxNewSessionDetached(name, {
      cwd: spec.cwd,
      cols: spec.cols,
      rows: spec.rows,
      flags: sessionEnvFlags(spec),
      command: ['--', '/bin/sh', '-c', 'exec sleep 86400'],
    });
    if (isDuplicateSession(result)) continue;
    checked(result, `new-session -s ${name}`);
    try {
      // Publish complete metadata and launch in one native command queue, so
      // another client cannot discover a partly tagged placeholder.
      runCommands([
        ...optionCommands(name, plan.tags, plan.retainOnExit),
        commandArgs(name, spec, true),
      ]);
      return name;
    } catch (error) {
      tmuxKillSession(name);
      throw error;
    }
  }
  throw new Error(`no free tmux session name for ${label}`);
}

export function prepareTmuxSession(
  spec: SessionSpec,
  plan: TmuxLaunchPlan
): string {
  if (plan.mode === 'create') return create(spec, plan);
  if (plan.mode === 'replace') {
    if (plan.target !== plan.expected.name)
      throw new Error('Replacement target does not match approval');
    runPlanCommands(plan, [
      commandArgs(plan.target, spec, true),
      ...optionCommands(plan.target, plan.tags, plan.retainOnExit),
    ]);
  } else if (plan.mode === 'restart') {
    const state = tmuxPaneState(plan.target);
    if (!state?.paneDead)
      throw new Error(
        `Cannot restart a running or missing tmux pane: ${plan.target}`
      );
    // A single native command queue stops at a failed respawn. Only the
    // winning launcher may update metadata, and options are applied before
    // tmux processes the new command's exit. No -k may kill a concurrent winner.
    runPlanCommands(plan, [
      commandArgs(plan.target, spec, false),
      ...optionCommands(plan.target, plan.tags, plan.retainOnExit),
    ]);
  } else if (plan.expected) {
    runPlanCommands(plan, [
      ['set-option', '-t', `=${plan.target}:`, 'status', 'off'],
    ]);
  } else {
    checked(tmuxSetOption(plan.target, 'status', 'off'), 'set-option status');
  }
  return plan.target;
}

function runPlanCommands(
  plan: Exclude<TmuxLaunchPlan, { mode: 'create' }>,
  commands: string[][]
): void {
  if (!plan.expected) return runCommands(commands);
  if (plan.target !== plan.expected.name)
    throw new Error('Launch target does not match approval');
  runGuardedTmuxCommands(plan.expected, commands, plan.expectedTags);
}
