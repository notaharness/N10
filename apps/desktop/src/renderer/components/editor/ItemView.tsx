import { Loader2Icon, PlayIcon, TerminalIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { SessionSummary, SidebarItem } from '../../../host/contract.js';
import { useRepo } from '../../lib/repo-context.js';
import {
  useAllBranches,
  useMachines,
  useSessions,
} from '../../lib/data/queries.js';
import { useReconnectSession } from '../../lib/data/mutations-terminals.js';
import { resolveMachineLabel } from '../../lib/machines/machine-model.js';
import {
  itemBranch,
  itemHasWorktree,
  itemRunning,
  itemSessionName,
  liveSessionName,
} from '../../lib/sidebar/sidebar-model.js';
import {
  clearLaunchMenuRequest,
  launchMenuOpen,
  useLaunchMenuRequested,
} from '../../lib/sidebar/launch-menu-request.js';
import {
  estimateTerminalGrid,
  paneTerminalGrid,
} from '../../lib/terminal-grid.js';
import { terminalPaneState } from '../../lib/terminals/terminal-pane-state.js';
import { PrWorkspace } from './lazy-panes.js';
import { Button } from '../ui/button.js';
import { LaunchDialog, type LaunchChoice } from './LaunchDialog.js';
import { useItemLaunch } from './use-item-launch.js';

/**
 * One editor tab for a sidebar item.
 *   • A pull request → the review workspace (PrWorkspace): a rail of
 *     Agent / Files / Comments beside a pane that swaps between the diff
 *     and the agent terminal. Launch/Stop live in the rail.
 *   • A bare worktree → its agent terminal, or a launch call-to-action.
 *
 * Every launch goes through the session menu (LaunchDialog) — it is
 * where the agent for this launch is chosen, whether or not the row has
 * a pull request.
 */

/**
 * A branch can hold two sidebar rows — the pull request, and the
 * worktree that actually owns the agent session. The tab may have been
 * opened from either, so both are folded together here and the pane
 * reads the live session regardless of which row it came from.
 */
function resolveItemState(
  item: SidebarItem,
  sessionRow: SidebarItem | undefined,
  aliveSessions: readonly SessionSummary[]
) {
  const rowSessionName =
    itemSessionName(item) ??
    (sessionRow ? itemSessionName(sessionRow) : undefined);
  const liveSession = aliveSessions.find((s) => s.name === rowSessionName);
  return {
    sessionName: liveSessionName(rowSessionName, aliveSessions),
    // Restarting an agent keeps the session's name, so the name alone
    // cannot tell the terminal that the thing on the other end of it is
    // a different process that has never been told the pane's size.
    sessionEpoch: liveSession?.spawnedAt ?? 0,
    running:
      itemRunning(item) || (sessionRow ? itemRunning(sessionRow) : false),
    hasWorktree: Boolean(rowSessionName) || itemHasWorktree(item),
    pr: item.pr ?? sessionRow?.pr,
    // The pane's connection banner (ux-machines.md §6) — independent of
    // `running` above, which is processState only (decisions.md D4).
    connectionState: liveSession?.connectionState,
    machine: liveSession?.machine,
  };
}

type ItemState = ReturnType<typeof resolveItemState>;

/**
 * The branch behind the tab and, once the item exists, what it has:
 * a worktree, a live session, a pull request.
 */
function useItemState(
  cwd: string,
  item: SidebarItem | undefined,
  items: SidebarItem[]
): { branch: string; state: ItemState | undefined } {
  const sessions = useSessions(cwd);
  const branch = item ? itemBranch(item) : '';
  const sessionRow = useMemo(
    () => items.find((i) => itemBranch(i) === branch && itemSessionName(i)),
    [items, branch]
  );
  const state = item
    ? resolveItemState(item, sessionRow, sessions.data ?? [])
    : undefined;
  return { branch, state };
}

function launchTarget(branch: string, state: ItemState | undefined) {
  return {
    branch,
    hasWorktree: state?.hasWorktree ?? false,
    pr: state?.pr,
    sessionName: state?.sessionName,
  };
}

/**
 * Default branch for PR-less worktree diffs: main, falling back to
 * master (the host's ref resolver prefers origin/<name>).
 */
function useBaseBranch(cwd: string): string {
  const allBranches = useAllBranches(cwd);
  return useMemo(() => {
    const names = new Set(
      (allBranches.data ?? []).map((b) => b.replace(/^origin\//, ''))
    );
    return names.has('main') ? 'main' : 'master';
  }, [allBranches.data]);
}

/**
 * Whether the session menu is showing. Two things open it: the tab's
 * own Launch button, and a request from outside the tab — the sidebar
 * (Enter, double-click, "Launch agent…") or the palette after a fresh
 * checkout. A request is honored once the item exists; a tab the user has left must not pop the
 * menu later, so inactive tabs drop the request.
 */
function useLaunchMenu(branch: string, active: boolean, state?: ItemState) {
  const [own, setOwn] = useState(false);
  const running = state?.running ?? false;
  const requested = useLaunchMenuRequested(branch);

  // The dialog portals to <body>, so an inactive-but-mounted
  // (visibility:hidden) pane would leave it floating over whichever
  // tab is active now — leaving the tab dismisses it.
  const [prevActive, setPrevActive] = useState(active);
  if (active !== prevActive) {
    setPrevActive(active);
    if (!active) setOwn(false);
  }
  useEffect(() => {
    if (requested && !active) clearLaunchMenuRequest(branch);
  }, [requested, active, branch]);
  // A tab closed before its item arrived (a checkout still in flight)
  // must not leave its request behind for a later visit to the branch.
  useEffect(() => () => clearLaunchMenuRequest(branch), [branch]);

  const open = launchMenuOpen({
    own,
    requested,
    hasItem: state !== undefined,
    running,
  });
  const close = () => {
    setOwn(false);
    clearLaunchMenuRequest(branch);
  };
  return { open, show: () => setOwn(true), close };
}

function Preparing({ itemKey }: { itemKey: string }) {
  // Either the worktree is still being created (optimistic tab) or the
  // item left the sidebar; show a quiet loading state — the pane
  // resolves itself on the next sidebar poll.
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
      <Loader2Icon className="size-6 animate-spin" />
      <p className="text-sm">Preparing {itemKey.replace(/^[a-z]+:/, '')}…</p>
    </div>
  );
}

/** The agent pane's connection banner (ux-machines.md §6) — Phase 5
 *  wired this into TerminalView only; a session running here is
 *  exactly where a silent dead remote connection does the most damage,
 *  since it is the headline capability of this whole feature. Split
 *  out to keep ItemView's own complexity down. */
function useConnectionBanner(
  sessionName: string | undefined,
  state: ItemState
) {
  const machines = useMachines();
  const reconnect = useReconnectSession();
  const pane = sessionName
    ? terminalPaneState({
        kind: 'agent',
        running: state.running,
        connectionState: state.connectionState,
      })
    : { bannerState: null, inputDisabled: false };
  const connectionBanner =
    pane.bannerState && sessionName
      ? {
          state: pane.bannerState,
          machineLabel:
            resolveMachineLabel(state.machine, machines.data) ?? 'this machine',
          onReconnect: () => reconnect.mutate(sessionName),
          reconnecting: reconnect.isPending,
        }
      : null;
  return { connectionBanner, inputDisabled: pane.inputDisabled };
}

export function ItemView({
  item,
  items,
  itemKey,
  active,
  onPin,
}: {
  item: SidebarItem | undefined;
  items: SidebarItem[];
  itemKey: string;
  active: boolean;
  onPin: () => void;
}) {
  const { repo } = useRepo();
  const paneRef = useRef<HTMLDivElement>(null);
  const { branch, state } = useItemState(repo.cwd, item, items);
  const baseBranch = useBaseBranch(repo.cwd);
  const menu = useLaunchMenu(branch, active, state);

  // Measured off the pane the terminal will actually occupy, not off
  // the tab: the rail beside it is resizable, so no fraction of the tab
  // is the right answer for long. The terminal re-fits itself once it
  // mounts, but an agent paints its first frame at whatever size it was
  // spawned with, and that frame is the one the user sees.
  const estimateGrid = () => {
    const tab = paneRef.current;
    if (!tab) return {};
    const pane = tab.querySelector<HTMLElement>('[data-terminal-pane]');
    const measured = pane ? paneTerminalGrid(pane) : null;
    if (measured) return measured;
    // Launching on a branch with no worktree yet: the content pane does
    // not exist to measure (nor is it laid out), and the rail whose
    // width it excludes is not on screen either. A deliberately conservative fraction of the tab
    // is the least bad guess — too narrow costs a reflow, too wide
    // costs wrapped output — and the terminal corrects it either way
    // the moment it mounts.
    return estimateTerminalGrid(tab.getBoundingClientRect(), 0.6);
  };
  const { choose, stop, busy, remoteStep, remoteError, resetRemote } =
    useItemLaunch(
      repo.cwd,
      launchTarget(branch, state),
      estimateGrid,
      menu.close
    );
  const { connectionBanner, inputDisabled } = useConnectionBanner(
    state?.sessionName,
    state ?? {
      sessionName: undefined,
      sessionEpoch: 0,
      running: false,
      hasWorktree: false,
      pr: undefined,
      connectionState: undefined,
      machine: undefined,
    }
  );

  if (!item || !state) return <Preparing itemKey={itemKey} />;
  const { sessionName, sessionEpoch, running, hasWorktree, pr } = state;

  const onLaunchClick = () => {
    onPin();
    menu.show();
  };
  // A remote launch leaves the dialog open to show its step, and to
  // keep the user's input intact on a named failure (ux-machines.md
  // §5) — closing here as eagerly as a local launch would lose both.
  // `useItemLaunch` closes it itself once the launch actually lands.
  const closeMenu = () => {
    resetRemote();
    menu.close();
  };
  const onChoose = (choice: LaunchChoice) => {
    onPin();
    if (!choice.machine) closeMenu();
    choose(choice);
  };
  const dialog = menu.open && (
    <LaunchDialog
      pr={pr}
      branch={branch}
      hasWorktree={hasWorktree}
      cwd={repo.cwd}
      busy={busy}
      remoteStep={remoteStep}
      remoteError={remoteError}
      onChoose={onChoose}
      onClose={closeMenu}
    />
  );

  // A pull request is the full review workspace (its own merged header,
  // rail, and content). A bare worktree keeps a simple header + terminal.
  if (pr) {
    return (
      <div ref={paneRef} className="flex h-full min-h-0 min-w-0 flex-col">
        <PrWorkspace
          pr={pr}
          branch={pr.sourceBranch}
          baseBranch={pr.targetBranch}
          sessionName={sessionName}
          sessionEpoch={sessionEpoch}
          running={running}
          active={active}
          busy={busy}
          onLaunch={onLaunchClick}
          onStop={stop}
          connectionBanner={connectionBanner}
          inputDisabled={inputDisabled}
        />
        {dialog}
      </div>
    );
  }

  // A worktree without a PR: same workspace, gracefully degraded —
  // Agent + Files rail with the diff vs the default branch; no
  // comments/drafts sections. Worktree still being created → loader.
  return (
    <div ref={paneRef} className="flex h-full min-h-0 min-w-0 flex-col">
      {hasWorktree ? (
        <PrWorkspace
          branch={branch}
          baseBranch={baseBranch}
          sessionName={sessionName}
          sessionEpoch={sessionEpoch}
          running={running}
          active={active}
          busy={busy}
          onLaunch={onLaunchClick}
          onStop={stop}
          connectionBanner={connectionBanner}
          inputDisabled={inputDisabled}
        />
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-muted-foreground">
          <TerminalIcon className="size-10 opacity-30" />
          <p className="text-base">No worktree for this branch yet.</p>
          <Button onClick={onLaunchClick} disabled={busy}>
            <PlayIcon /> Check out & launch
          </Button>
        </div>
      )}
      {dialog}
    </div>
  );
}
