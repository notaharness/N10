import type {
  AgentOptionView,
  LaunchStep,
  SessionLaunchView,
} from '../../../host/contract.js';
import type { useMachineChoice } from '../terminal/NewTerminalMachineChoice.js';
import { ContinueContext } from './LaunchSessionContext.js';
import { LaunchAgentPicker } from './LaunchAgentPicker.js';
import { LaunchMachineSection } from './LaunchMachineSection.js';
import { errorMessage } from '../../lib/utils.js';
import { ReviewInstructions, ReplacementNotice } from './LaunchInstructions.js';
import type { Mode } from './LaunchDialog.js';

/** The dialog's content below the mode toggle — status, the agent and
 *  machine pickers, the mode-specific body, and the replacement notice.
 *  Split out of `LaunchDialog` to keep its own complexity under budget:
 *  every branch here is a per-mode "show this, not that" the dialog
 *  itself no longer has to hold. */
export function LaunchDialogBody({
  mode,
  info,
  fetching,
  contextError,
  agentOptionsError,
  agents,
  agentIndex,
  onAgentIndexChange,
  machineChoice,
  remoteStep,
  remoteError,
  instruction,
  onInstructionChange,
  onSubmit,
  replacing,
}: {
  mode: Mode;
  info: SessionLaunchView | undefined;
  fetching: boolean;
  contextError: Error | null;
  agentOptionsError: Error | null;
  agents: AgentOptionView[];
  agentIndex: number;
  onAgentIndexChange: (index: number) => void;
  machineChoice: ReturnType<typeof useMachineChoice>;
  remoteStep?: LaunchStep | null;
  remoteError?: string | null;
  instruction: string;
  onInstructionChange: (value: string) => void;
  onSubmit: () => void;
  replacing: boolean;
}) {
  const continuing = mode === 'continue';
  return (
    <div className="min-w-0 space-y-5 p-5 [overflow-wrap:anywhere]">
      <LaunchStatus
        fetching={fetching}
        error={contextError}
        agentError={continuing ? null : agentOptionsError}
      />
      {!continuing && (
        <>
          <LaunchAgentPicker
            agents={agents}
            index={agentIndex}
            onChange={onAgentIndexChange}
          />
          <LaunchMachineSection
            choice={machineChoice}
            step={remoteStep}
            error={remoteError}
            what={whatLabel(mode, info, agents, agentIndex)}
          />
        </>
      )}
      {continuing && info && <ContinueContext info={info} />}
      {mode === 'new' && (
        <p className="text-muted-foreground">
          Start a fresh conversation in this worktree.
        </p>
      )}
      {mode === 'review' && (
        <ReviewInstructions
          value={instruction}
          onChange={onInstructionChange}
          onSubmit={onSubmit}
        />
      )}
      {replacing && <ReplacementNotice info={info} mode={mode} />}
    </div>
  );
}

/** What `RemoteLaunchProgress` names as starting: the review task, the
 *  session's own recorded agent for "Continue", or the picked agent
 *  for a fresh one — split out as a pure function to keep
 *  `LaunchDialogBody` itself under the complexity budget. */
function whatLabel(
  mode: Mode,
  info: SessionLaunchView | undefined,
  agents: AgentOptionView[],
  agentIndex: number
): string {
  if (mode === 'review') return 'review';
  if (mode === 'continue') return info?.recordedAgentName ?? 'agent';
  return agents[agentIndex]?.name ?? 'agent';
}

function LaunchStatus({
  fetching,
  error,
  agentError,
}: {
  fetching: boolean;
  error: Error | null;
  agentError: Error | null;
}) {
  return (
    <>
      {fetching && <p className="text-muted-foreground">Reading session…</p>}
      {error && <p role="alert">{errorMessage(error)}</p>}
      {agentError && <p role="alert">{errorMessage(agentError)}</p>}
    </>
  );
}
