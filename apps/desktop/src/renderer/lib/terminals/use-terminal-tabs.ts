import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { TerminalKind, TerminalSummary } from '../../../host/contract.js';
import { useTerminals } from '../data/queries.js';
import { useLaunchTerminal } from '../data/mutations-terminals.js';
import { useTabs, type TerminalEntry } from '../tabs/tabs.js';
import { estimateTerminalGrid, paneTerminalGrid } from '../terminal-grid.js';
import { errorMessage } from '../utils.js';

/** The host's summary, as the tab model keeps it. */
function toEntry(t: TerminalSummary): TerminalEntry {
  return {
    name: t.name,
    kind: t.kind,
    cwd: t.cwd,
    displayPath: t.displayPath,
    repo: t.repo,
  };
}

/**
 * The grid a new terminal is spawned at. Measured off the pane area the
 * tab will occupy when there is one on screen; a window with no tabs
 * open has no pane to measure, so the editor's share of the window is
 * the estimate then. The terminal corrects it the moment it mounts.
 */
function estimatePane(): { cols?: number; rows?: number } {
  const panes = document.querySelector<HTMLElement>('[data-editor-panes]');
  const measured = panes ? paneTerminalGrid(panes) : null;
  if (measured) return measured;
  return estimateTerminalGrid({
    width: window.innerWidth - 280,
    height: window.innerHeight - 80,
  });
}

/**
 * Terminal tabs, renderer side: the host's terminal listing, ready for
 * Workspace's own `sync-items` effect to reconcile alongside the
 * sidebar (the restore path, and terminals discovery finds mid-run),
 * plus opening one on request.
 *
 * Deliberately does not dispatch a sync of its own — terminals are not
 * sidebar items and the listing is not repo-scoped, but folding both
 * into the one action Workspace dispatches keeps every reconciliation
 * of the strip behind a single pure step instead of two effects racing
 * into the reducer independently.
 */
export function useTerminalTabs() {
  const tabs = useTabs();
  const terminals = useTerminals();
  const launch = useLaunchTerminal();
  const [dialogOpen, setDialogOpen] = useState(false);

  // `undefined` until the host has answered once — and it stays the
  // previous answer across a refetch (`placeholderData`) — so the strip
  // never sees "no terminals" when the truth is "not asked yet". The
  // reducer closes the tab of any terminal a listing does not name.
  const entries = useMemo(() => terminals.data?.map(toEntry), [terminals.data]);

  const launchMutate = launch.mutate;
  const openTerminal = tabs.openTerminal;
  const launchTerminal = useCallback(
    (kind: TerminalKind, cwd: string) => {
      setDialogOpen(false);
      launchMutate(
        { kind, cwd, ...estimatePane() },
        {
          // The tab is opened here rather than waiting for the listing:
          // activating it is what switches the workspace when the
          // terminal belongs to another repository.
          onSuccess: (summary) => openTerminal(toEntry(summary)),
          onError: (e) => toast.error(errorMessage(e)),
        }
      );
    },
    [launchMutate, openTerminal]
  );

  return {
    /** The host's terminal listing, for Workspace's sync effect;
     *  `undefined` before the first answer. */
    entries,
    dialogOpen,
    openDialog: useCallback(() => setDialogOpen(true), []),
    closeDialog: useCallback(() => setDialogOpen(false), []),
    launchTerminal,
    busy: launch.isPending,
  };
}
