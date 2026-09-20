import { useCallback, useMemo, useState } from 'react';
import { useTerminals } from '../data/queries.js';
import type { Mode } from './review-model.js';
import {
  resolvePickedSession,
  worktreeSessions,
  type WorktreeSession,
} from './worktree-sessions.js';

/**
 * The worktree's sessions and which one the pane is on.
 *
 * Split out of `PrWorkspace` because it is a self-contained piece of
 * state — the listing, the pick, and what selecting a row does — and
 * the workspace has enough of its own.
 */
export function useWorktreeSessionPicker({
  branchSession,
  branchAgentRunning,
  branchAgentName,
  worktreePath,
  setMode,
}: {
  branchSession?: string;
  branchAgentRunning: boolean;
  branchAgentName?: string;
  worktreePath?: string;
  setMode: (mode: Mode) => void;
}) {
  const [pickedName, setPickedName] = useState<string | null>(null);
  const terminals = useTerminals();
  const sessions = useMemo(
    () =>
      worktreeSessions({
        branchSession,
        branchAgentRunning,
        branchAgentName,
        terminals: terminals.data ?? [],
        worktreePath,
      }),
    [
      branchSession,
      branchAgentRunning,
      branchAgentName,
      terminals.data,
      worktreePath,
    ]
  );
  const picked = resolvePickedSession(pickedName, sessions);

  // The branch agent keeps its own pane mode, so the agent-focus rule
  // and everything already written against `'agent'` still holds.
  const select = useCallback(
    (session: WorktreeSession) => {
      if (session.isBranchAgent) {
        setPickedName(null);
        setMode('agent');
        return;
      }
      setPickedName(session.name);
      setMode('session');
    },
    [setMode]
  );

  return { sessions, picked, select };
}
