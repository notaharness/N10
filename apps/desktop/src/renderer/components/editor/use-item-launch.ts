import { useState } from 'react';
import { toast } from 'sonner';
import type { PullRequestInfo } from '@n10/vcs-core';
import type {
  AgentId,
  SessionIncarnation,
  SessionLaunchRequest,
} from '../../../host/contract.js';
import {
  useCreateWorktree,
  useKillSession,
  useLaunchAgent,
  useLaunchReview,
} from '../../lib/data/mutations.js';
import { useLaunchProgress } from '../../lib/machines/launch-progress.js';
import { errorMessage } from '../../lib/utils.js';
import type { LaunchChoice } from './LaunchDialog.js';
import { reviewLaunchRequest, sessionLaunchRequest } from './launch-request.js';

/** What a tab is launching into — the branch, and what it has so far. */
export interface LaunchTarget {
  branch: string;
  hasWorktree: boolean;
  pr: PullRequestInfo | undefined;
  sessionName: string | undefined;
}

type Grid = Pick<SessionLaunchRequest, 'cols' | 'rows'>;

/**
 * The tab's launch actions, behind the session menu: start a session
 * with the agent chosen there (checking the worktree out first when
 * the row has none), start a review, or stop the running agent.
 *
 * A choice that names a `machine` (ux-machines.md §5) skips the local
 * worktree checkout above — the host creates the worktree on the
 * chosen machine itself, as the first named step of the same
 * `launchAgent`/`launchReviewAgent` call, and running `createWorktree`
 * here first would put it on the wrong (local) box. `onRemoteSuccess`
 * is called only once a remote launch actually lands, so the caller
 * (the dialog's owner) can close it then rather than eagerly; a local
 * launch keeps closing eagerly, unchanged from before this phase.
 */
export function useItemLaunch(
  cwd: string,
  target: LaunchTarget,
  estimateGrid: () => Grid,
  onRemoteSuccess: () => void
) {
  const launch = useLaunchAgent(cwd);
  const launchReview = useLaunchReview(cwd);
  const kill = useKillSession(cwd);
  const create = useCreateWorktree(cwd);
  const progress = useLaunchProgress();
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const { branch, hasWorktree, pr, sessionName } = target;

  const startSession = async (
    fresh: boolean,
    expected?: SessionIncarnation,
    agentId?: AgentId,
    machine?: string
  ) => {
    if (!hasWorktree && !machine) {
      const id = toast.loading(`Checking out ${branch}…`);
      try {
        await create.mutateAsync(branch);
        toast.success(`Worktree ready: ${branch}`, { id });
      } catch (e) {
        toast.error(errorMessage(e), { id });
        return;
      }
    }
    const launchId = machine ? progress.start() : undefined;
    if (machine) setRemoteError(null);
    launch.mutate(
      sessionLaunchRequest(
        branch,
        fresh,
        estimateGrid(),
        expected,
        agentId,
        machine,
        launchId
      ),
      {
        onSuccess: () => {
          if (!machine) return;
          progress.reset();
          onRemoteSuccess();
        },
        onError: (e) => {
          if (machine) setRemoteError(errorMessage(e));
          else toast.error(errorMessage(e));
        },
      }
    );
  };

  const startReview = (
    instruction: string | undefined,
    expected: SessionIncarnation | undefined,
    agentId: AgentId | undefined,
    machine?: string
  ) => {
    if (!pr) return;
    const id = machine
      ? undefined
      : toast.loading(
          hasWorktree
            ? 'Starting review…'
            : `Checking out ${branch} and starting review…`
        );
    const launchId = machine ? progress.start() : undefined;
    if (machine) setRemoteError(null);
    launchReview.mutate(
      reviewLaunchRequest(
        pr,
        instruction,
        estimateGrid(),
        expected,
        agentId,
        machine,
        launchId
      ),
      {
        onSuccess: () => {
          if (machine) {
            progress.reset();
            onRemoteSuccess();
          } else {
            toast.success('Review agent started', { id });
          }
        },
        onError: (e) => {
          if (machine) setRemoteError(errorMessage(e));
          else toast.error(errorMessage(e), { id });
        },
      }
    );
  };

  const choose = (choice: LaunchChoice) => {
    if (choice.kind === 'session')
      void startSession(
        choice.fresh,
        choice.expected,
        choice.agentId,
        choice.machine
      );
    else
      startReview(
        choice.instruction,
        choice.expected,
        choice.agentId,
        choice.machine
      );
  };

  const stop = () =>
    sessionName &&
    kill.mutate(sessionName, { onError: (e) => toast.error(errorMessage(e)) });

  const resetRemote = () => {
    progress.reset();
    setRemoteError(null);
  };

  return {
    choose,
    stop,
    busy: launch.isPending || create.isPending || launchReview.isPending,
    /** Set only during a remote launch (ux-machines.md §5); a local
     *  launch is fast enough that showing this would be a regression. */
    remoteStep: progress.step,
    remoteError,
    resetRemote,
  };
}
