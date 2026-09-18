import { useState } from 'react';
import { toast } from 'sonner';
import type { BabysitStatus, SidebarItem } from '../../../host/contract.js';
import { useRepo } from '../../lib/repo-context.js';
import {
  useCreateWorktree,
  useKillSession,
  useOpenInEditor,
} from '../../lib/data/mutations.js';
import { useMachines, useSessions } from '../../lib/data/queries.js';
import {
  hasPeerMachines,
  resolveMachineLabel,
} from '../../lib/machines/machine-model.js';
import { babysitBadge } from '../../lib/sidebar/babysit-badge.js';
import {
  itemBranch,
  itemHasWorktree,
  itemKey,
  itemRunning,
  itemSessionName,
  itemTitle,
} from '../../lib/sidebar/sidebar-model.js';
import {
  isPrRowCommand,
  isSidebarRowCommand,
  sidebarRowMenuItems,
} from '../../lib/sidebar/sidebar-row-menu.js';
import { requestLaunchMenu } from '../../lib/sidebar/launch-menu-request.js';
import { cn, errorMessage } from '../../lib/utils.js';
import { PrMeta } from './PrMeta.js';
import { RemoveWorktreeDialog } from './RemoveWorktreeDialog.js';
import { ItemIcon } from './SidebarRowIcon.js';
import { usePullRequestRow } from './use-pull-request-row.js';

/**
 * What the branch is doing, beside its name. All three can be true at
 * once — a merged branch can still be mid-rebase with conflicts — so
 * they render as separate badges rather than one status.
 */
function RowBadges({
  merged,
  rebasing,
  conflictCount,
  babysit,
  machineLabel,
}: {
  merged: boolean;
  rebasing: boolean;
  conflictCount: number;
  babysit: BabysitStatus | undefined;
  /** The row's session machine, resolved by the caller — only when
   *  more than one machine is registered (ux-machines.md §6, D8). */
  machineLabel: string | null;
}) {
  const conflicts = `${conflictCount} conflict${
    conflictCount === 1 ? '' : 's'
  }`;
  const sitter = babysit && babysitBadge(babysit);
  return (
    <>
      {machineLabel && (
        <span className="shrink-0 rounded bg-muted px-1 text-[10px] font-medium text-muted-foreground">
          {machineLabel}
        </span>
      )}
      {sitter && (
        <span
          className={cn(
            'shrink-0 rounded px-1 text-[10px] font-medium',
            sitter.tone === 'warning'
              ? 'bg-warning/15 text-warning'
              : 'bg-info/15 text-info'
          )}
          title={sitter.title}
        >
          {sitter.label}
        </span>
      )}
      {merged && (
        <span className="shrink-0 rounded bg-success/15 px-1 text-[10px] font-medium text-success">
          merged
        </span>
      )}
      {rebasing && (
        <span className="shrink-0 rounded bg-warning/15 px-1 text-[10px] font-medium text-warning">
          rebasing
        </span>
      )}
      {conflictCount > 0 && (
        <span
          className="shrink-0 rounded bg-warning/15 px-1 text-[10px] font-medium text-warning"
          title={`${conflicts} against the main branch`}
        >
          {conflicts}
        </span>
      )}
    </>
  );
}

/** The row's machine badge (ux-machines.md §6) — only when more than
 *  one machine is registered (D8). Split out to keep SidebarRow's own
 *  complexity down. */
function useRowMachineLabel(
  cwd: string,
  sessionName: string | undefined
): string | null {
  const sessions = useSessions(cwd);
  const machines = useMachines();
  if (!hasPeerMachines(machines.data ?? [])) return null;
  return resolveMachineLabel(
    sessions.data?.find((s) => s.name === sessionName)?.machine,
    machines.data
  );
}

export function SidebarRow({
  item,
  active,
  onOpen,
}: {
  item: SidebarItem;
  active: boolean;
  onOpen: (preview: boolean) => void;
}) {
  const { repo } = useRepo();
  const kill = useKillSession(repo.cwd);
  const create = useCreateWorktree(repo.cwd);
  const openEditor = useOpenInEditor();
  const [confirmRemove, setConfirmRemove] = useState(false);

  const running = itemRunning(item);
  const hasWorktree = itemHasWorktree(item);
  const branch = itemBranch(item);
  const sessionName = itemSessionName(item);
  const machineLabel = useRowMachineLabel(repo.cwd, sessionName);
  const pr = item.pr;
  const title = itemTitle(item);
  const rebasing = item.kind === 'session' && item.session.state === 'rebasing';
  const merged = item.kind === 'session' && item.isMerged;
  const conflictCount =
    (item.kind === 'session' ? item.conflictCount : undefined) ?? 0;
  const pullRequest = usePullRequestRow(pr, repo.cwd);

  // Open the tab and its session menu for attach, continuation or an
  // explicitly confirmed fresh conversation.
  const onLaunch = () => {
    requestLaunchMenu(branch);
    onOpen(false);
  };
  const onKill = () =>
    sessionName &&
    kill.mutate(sessionName, { onError: (e) => toast.error(errorMessage(e)) });
  const onCheckout = () => {
    onOpen(false); // show the tab right away; it loads while git works
    create.mutate(branch, {
      onSuccess: () => toast.success(`Worktree ready: ${branch}`),
      onError: (e) => toast.error(errorMessage(e)),
    });
  };

  // Double-click and Enter on a row open the tab and, for an idle
  // agent, its session menu (the TUI's Enter behaviour); a live agent's
  // tab just opens. Single click stays a preview.
  const onActivate = onLaunch;

  /** Native (OS) context menu — built from the item's state. */
  const openContextMenu = async (e: React.MouseEvent) => {
    e.preventDefault();
    const chosen = await window.n10.showContextMenu(
      sidebarRowMenuItems({
        hasWorktree,
        running,
        hasPr: Boolean(pr),
        babysitting: Boolean(item.babysit),
      })
    );
    if (!isSidebarRowCommand(chosen)) return;
    if (isPrRowCommand(chosen)) {
      pullRequest.run(chosen);
      return;
    }
    switch (chosen) {
      case 'open':
        onOpen(false);
        break;
      case 'launch':
        onLaunch();
        break;
      case 'kill':
        onKill();
        break;
      case 'checkout':
        onCheckout();
        break;
      case 'open-editor':
        openEditor.mutate(branch, {
          onSuccess: ({ editor }) => toast.success(`Opened in ${editor}`),
          onError: (e) => toast.error(errorMessage(e)),
        });
        break;
      case 'copy':
        void navigator.clipboard.writeText(branch);
        toast.success('Branch name copied');
        break;
      case 'remove':
        setConfirmRemove(true);
        break;
    }
  };

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={() => onOpen(true)}
        onDoubleClick={onActivate}
        onContextMenu={(e) => void openContextMenu(e)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onActivate();
        }}
        className={cn(
          'group flex w-full cursor-default items-center gap-2 py-[3px] pr-2 pl-4 text-base outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring/60',
          active
            ? 'bg-sidebar-active text-sidebar-accent-foreground'
            : 'hover:bg-sidebar-accent'
        )}
      >
        <ItemIcon item={item} running={running} />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="flex items-center gap-1.5">
            <span
              className={cn('truncate', running && 'font-medium')}
              title={title}
            >
              {title}
            </span>
            <RowBadges
              merged={merged}
              rebasing={rebasing}
              conflictCount={conflictCount}
              babysit={item.babysit}
              machineLabel={machineLabel}
            />
          </div>
          {pr && (
            <div
              className="flex items-center gap-1.5 text-xs text-muted-foreground"
              title={item.kind === 'session' ? itemBranch(item) : pr.title}
            >
              <span className="shrink-0 tabular-nums">#{pr.id}</span>
              <span className="min-w-0 truncate">
                {item.kind === 'session'
                  ? itemBranch(item)
                  : pr.createdByDisplayName}
              </span>
            </div>
          )}
        </div>
        {pr && <PrMeta pr={pr} />}
      </div>
      {confirmRemove && (
        <RemoveWorktreeDialog
          branch={branch}
          itemKey={itemKey(item)}
          running={running}
          onClose={() => setConfirmRemove(false)}
        />
      )}
    </>
  );
}
