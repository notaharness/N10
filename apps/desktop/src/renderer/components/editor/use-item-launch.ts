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
import { errorMessage } from '../../lib/utils.js';
import type { LaunchChoice } from './LaunchDialog.js';

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
 */
export function useItemLaunch(
  cwd: string,
  target: LaunchTarget,
  estimateGrid: () => Grid
) {
  const launch = useLaunchAgent(cwd);
  const launchReview = useLaunchReview(cwd);
  const kill = useKillSession(cwd);
  const create = useCreateWorktree(cwd);
  const { branch, hasWorktree, pr, sessionName } = target;

  const startSession = async (
    fresh: boolean,
    expected?: SessionIncarnation,
    agentId?: AgentId,
    configDir?: string
  ) => {
    if (!hasWorktree) {
      const id = toast.loading(`Checking out ${branch}…`);
      try {
        await create.mutateAsync(branch);
        toast.success(`Worktree ready: ${branch}`, { id });
      } catch (e) {
        toast.error(errorMessage(e), { id });
        return;
      }
    }
    launch.mutate(
      {
        branch,
        intent: fresh ? 'blank' : 'continue-or-blank',
        fresh,
        expected,
        agentId,
        configDir,
        ...estimateGrid(),
      },
      { onError: (e) => toast.error(errorMessage(e)) }
    );
  };

  const startReview = (
    instruction?: string,
    agentId?: AgentId,
    configDir?: string
  ) => {
    if (!pr) return;
    const id = toast.loading(
      hasWorktree
        ? 'Starting review…'
        : `Checking out ${branch} and starting review…`
    );
    launchReview.mutate(
      { pr, instruction, agentId, configDir, ...estimateGrid() },
      {
        onSuccess: () =>
          toast.success('Review running in its own session', {
            id,
            description: 'Comments appear in the diff as it posts them.',
          }),
        onError: (e) => toast.error(errorMessage(e), { id }),
      }
    );
  };

  const choose = (choice: LaunchChoice) => {
    if (choice.kind === 'session')
      void startSession(
        choice.fresh,
        choice.expected,
        choice.agentId,
        choice.configDir
      );
    else startReview(choice.instruction, choice.agentId, choice.configDir);
  };

  const stop = () =>
    sessionName &&
    kill.mutate(sessionName, { onError: (e) => toast.error(errorMessage(e)) });

  return {
    choose,
    stop,
    busy: launch.isPending || create.isPending || launchReview.isPending,
  };
}
