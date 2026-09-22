import type {
  AgentId,
  AgentOptionView,
  SessionIncarnation,
  SessionLaunchView,
} from '../../../host/contract.js';

/**
 * Pure decisions behind the launch dialog — what mode is in effect,
 * whether the action is disabled, what it's labelled, and what choice
 * a click resolves to. Split out so `LaunchDialog.tsx` stays the
 * rendering, not the reasoning (mirrors `lib/review/review-model.ts`
 * for `PrWorkspace`).
 */

export type LaunchChoice =
  | {
      kind: 'session';
      fresh: boolean;
      agentId?: AgentId;
      expected?: SessionIncarnation;
      /** Set only when the picker was actually shown — see
       *  `shouldShowConfigDirPicker`. "Unset" is meaningful: it leaves
       *  the host's own default in force. */
      configDir?: string;
    }
  | {
      kind: 'review';
      instruction?: string;
      agentId?: AgentId;
      configDir?: string;
    };

export type Mode = 'continue' | 'new' | 'review';

export function canContinueSession(info?: SessionLaunchView) {
  return Boolean(info?.exists && (info.running || info.canResume));
}

export function selectedMode(
  selected: Mode | null,
  canContinue: boolean
): Mode {
  if (selected === 'continue' && !canContinue) return 'new';
  return selected ?? (canContinue ? 'continue' : 'new');
}

export function launchDisabled(
  info: SessionLaunchView | undefined,
  fetching: boolean,
  error: boolean,
  mode: Mode,
  agents: number
) {
  return !info || fetching || error || (mode !== 'continue' && agents === 0);
}

export function launchChoice(
  mode: Mode,
  info: SessionLaunchView,
  instruction: string,
  agentId: AgentId | undefined,
  showConfigDirPicker: boolean,
  configDirValue: string
): LaunchChoice {
  // "Unset" is meaningful (it leaves the host's own default in force),
  // so the token is only ever sent when the picker was actually shown.
  const configDir = showConfigDirPicker ? configDirValue : undefined;
  // A review runs in a session of its own, so it neither needs nor
  // uses the branch session's incarnation guard.
  if (mode === 'review')
    return {
      kind: 'review',
      agentId,
      configDir,
      instruction: instruction.trim() || undefined,
    };
  return {
    kind: 'session',
    agentId: mode === 'new' ? agentId : undefined,
    configDir,
    fresh: mode === 'new',
    expected: info.incarnation,
  };
}

/** The default, until the user touches the picker, is the first entry
 *  — the host's own configured default when nothing else is chosen. */
export function resolvedConfigDir(
  token: string | undefined,
  dirs: string[]
): string {
  return token ?? dirs[0];
}

/** Mirrors how the toggle group hides "Continue"/"Review" when they do
 *  not apply: a single registered directory, or an agent other than
 *  Claude, means the control has nothing to offer, so it renders
 *  nothing rather than a disabled or one-item select. */
export function shouldShowConfigDirPicker(
  mode: Mode,
  dirs: string[],
  agents: AgentOptionView[],
  agentIndex: number
): boolean {
  return (
    mode !== 'continue' &&
    dirs.length > 1 &&
    agents[agentIndex]?.id === 'claude'
  );
}

export function actionLabel(
  mode: Mode,
  info: SessionLaunchView | undefined,
  replacing: boolean
) {
  if (mode === 'continue')
    return `${info?.running ? 'Open' : 'Continue with'} ${
      info?.recordedAgentName ?? 'session'
    }`;
  if (mode === 'review') return 'Start review';
  return `${replacing ? 'Stop and start' : 'Start'} new session`;
}

/** The agent picker is hidden while continuing, so its error has
 *  nothing to attach to then either. */
export function agentPickerError(
  mode: Mode,
  error: Error | null
): Error | null {
  return mode === 'continue' ? null : error;
}

/** Only a new conversation takes the branch's session. A review gets
 *  one of its own and leaves whatever is running where it is. */
export function isReplacing(mode: Mode, info?: SessionLaunchView) {
  return mode === 'new' && Boolean(info?.running);
}
