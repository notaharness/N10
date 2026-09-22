import { useQuery } from '@tanstack/react-query';
import { PlayIcon } from 'lucide-react';
import { useState } from 'react';
import type { PullRequestInfo } from '@n10/vcs-core';
import { useAgentConfigDirs, useAgentOptions } from '../../lib/data/queries.js';
import { agentIdForLaunch } from '../../lib/agent-pick.js';
import { ContinueContext } from './LaunchSessionContext.js';
import { LaunchAgentPicker } from './LaunchAgentPicker.js';
import { LaunchConfigDirPicker } from './LaunchConfigDirPicker.js';
import { errorMessage } from '../../lib/utils.js';
import { Button } from '../ui/button.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog.js';
import { ReviewInstructions, ReplacementNotice } from './LaunchInstructions.js';
import { ToggleGroup, ToggleGroupItem } from '../ui/toggle-group.js';
import {
  actionLabel,
  agentPickerError,
  canContinueSession,
  isReplacing,
  launchChoice,
  launchDisabled,
  resolvedConfigDir,
  selectedMode,
  shouldShowConfigDirPicker,
  type LaunchChoice,
  type Mode,
} from './launch-dialog-model.js';

export type { LaunchChoice } from './launch-dialog-model.js';

/** Session choices are based on a native snapshot, also used to guard replacement. */
export function LaunchDialog({
  pr,
  branch,
  cwd,
  hasWorktree,
  onChoose,
  onClose,
}: {
  pr?: PullRequestInfo;
  branch: string;
  cwd: string;
  hasWorktree: boolean;
  onChoose: (choice: LaunchChoice) => void;
  onClose: () => void;
}) {
  const context = useQuery({
    queryKey: ['session-launch-context', cwd, branch],
    queryFn: () => window.n10.getSessionLaunchContext(branch),
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
  const [selected, setSelected] = useState<Mode | null>(null);
  const [instruction, setInstruction] = useState('');
  const options = useAgentOptions(cwd);
  const agents = options.data ?? [];
  const [agentIndex, setAgentIndex] = useState(0);
  const configDirs = useAgentConfigDirs();
  const dirs = configDirs.data ?? [];
  const [configDirToken, setConfigDirToken] = useState<string>();
  const info = context.data;
  const canContinue = canContinueSession(info);
  const mode = selectedMode(selected, canContinue);
  const replacing = isReplacing(mode, info);
  const disabled = launchDisabled(
    info,
    context.isFetching,
    context.isError,
    mode,
    agents.length
  );
  const showConfigDirPicker = shouldShowConfigDirPicker(
    mode,
    dirs,
    agents,
    agentIndex
  );
  const configDirValue = resolvedConfigDir(configDirToken, dirs);
  const go = () => {
    if (!info || disabled) return;
    onChoose(
      launchChoice(
        mode,
        info,
        instruction,
        agentIdForLaunch(agents, agentIndex),
        showConfigDirPicker,
        configDirValue
      )
    );
  };
  const action = actionLabel(mode, info, replacing);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        data-launch-dialog
        className="flex max-h-[calc(100dvh-2rem)] min-w-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-xl"
      >
        <div className="min-h-0 min-w-0 overflow-y-auto">
          <LaunchHeader pr={pr} branch={branch} hasWorktree={hasWorktree} />
          <ToggleGroup
            type="single"
            value={mode}
            onValueChange={(value) => value && setSelected(value as Mode)}
            aria-label="Session action"
            className="gap-1 border-b px-5 pb-4"
          >
            {canContinue && <Action value="continue">Continue</Action>}
            <Action value="new">New session</Action>
            {pr && <Action value="review">Review</Action>}
          </ToggleGroup>
          <div className="min-w-0 space-y-5 p-5 [overflow-wrap:anywhere]">
            <LaunchStatus
              fetching={context.isFetching}
              error={context.error}
              agentError={agentPickerError(mode, options.error)}
            />
            {mode !== 'continue' && (
              <LaunchAgentPicker
                agents={agents}
                index={agentIndex}
                onChange={setAgentIndex}
              />
            )}
            {showConfigDirPicker && (
              <LaunchConfigDirPicker
                dirs={dirs}
                value={configDirValue}
                onChange={setConfigDirToken}
              />
            )}
            {info && mode === 'continue' && <ContinueContext info={info} />}
            {mode === 'new' && (
              <p className="text-muted-foreground">
                Start a fresh conversation in this worktree.
              </p>
            )}
            {mode === 'review' && (
              <ReviewInstructions
                value={instruction}
                onChange={setInstruction}
                onSubmit={go}
              />
            )}
            {replacing && <ReplacementNotice info={info} />}
          </div>
        </div>
        <DialogFooter className="shrink-0 flex-wrap border-t px-5 py-4">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={go}
            disabled={disabled}
            className="h-auto min-h-8 whitespace-normal text-left"
          >
            <PlayIcon className="shrink-0" />
            {action}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Action({ value, children }: { value: Mode; children: string }) {
  return (
    <ToggleGroupItem
      value={value}
      className="min-w-0 flex-1 rounded-md border border-transparent px-2 py-2 text-sm data-[state=on]:border-primary data-[state=on]:bg-primary/10 data-[state=on]:text-primary"
    >
      {children}
    </ToggleGroupItem>
  );
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

function LaunchHeader({
  pr,
  branch,
  hasWorktree,
}: {
  pr?: PullRequestInfo;
  branch: string;
  hasWorktree: boolean;
}) {
  return (
    <DialogHeader className="min-w-0 px-5 pt-5 pr-10 pb-4">
      {pr && (
        <p className="text-sm text-muted-foreground">Pull request #{pr.id}</p>
      )}
      <DialogTitle className="min-w-0 leading-snug [overflow-wrap:anywhere]">
        {pr?.title || branch}
      </DialogTitle>
      <DialogDescription className="min-w-0 [overflow-wrap:anywhere]">
        {pr ? `${pr.sourceBranch} → ${pr.targetBranch}` : 'Worktree'}
        {!hasWorktree && ' · a worktree will be created first'}
      </DialogDescription>
    </DialogHeader>
  );
}
