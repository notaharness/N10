import {
  AlertCircleIcon,
  CloudOffIcon,
  GitBranchIcon,
  Loader2Icon,
  MonitorIcon,
  RefreshCwIcon,
  TerminalIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type {
  MachineView,
  SidebarItem,
  SyncState,
} from '../../host/contract.js';
import { useRepo } from '../lib/repo-context.js';
import { useMachines, useSyncState, useVersion } from '../lib/data/queries.js';
import { useRefreshRemote } from '../lib/data/mutations.js';
import { itemRunning } from '../lib/sidebar/sidebar-model.js';
import { basename, cn, relativeTime } from '../lib/utils.js';
import { Tip } from './ui/tooltip.js';

/**
 * Bottom status strip: repo, provider sync state, running agent count,
 * build stamp. Every segment is a quiet button; clicking sync refreshes.
 */
export function StatusBar({
  items,
  onOpenSettings,
}: {
  items: SidebarItem[];
  onOpenSettings: () => void;
}) {
  const { repo } = useRepo();
  const sync = useSyncState(repo.cwd);
  const refresh = useRefreshRemote(repo.cwd);
  const version = useVersion();
  const machines = useMachines();
  const running = items.filter(itemRunning).length;

  // Re-render every 15s so "synced Xm ago" stays honest.
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((t) => t + 1), 15_000);
    return () => clearInterval(id);
  }, []);

  const s = sync.data;

  return (
    <footer className="flex h-[22px] shrink-0 select-none items-center border-t border-border bg-statusbar px-2 text-xs text-statusbar-foreground">
      <Segment label={repo.cwd}>
        <GitBranchIcon className="size-3" />
        <span className="font-medium">{basename(repo.cwd)}</span>
      </Segment>

      {s && (
        <ProviderSegment
          sync={s}
          refreshing={refresh.isPending}
          onRefresh={() => refresh.mutate()}
          onOpenSettings={onOpenSettings}
        />
      )}

      <div className="flex-1" />

      <MachinesSegment
        machines={machines.data}
        onOpenSettings={onOpenSettings}
      />

      {running > 0 && (
        <Segment label={`${running} agent${running === 1 ? '' : 's'} running`}>
          <TerminalIcon className="size-3 text-success" />
          {running} running
        </Segment>
      )}
      <Segment label="n10-desktop build">
        <span className="text-muted-foreground">
          v{version.data?.app ?? '…'}
        </span>
      </Segment>
    </footer>
  );
}

/**
 * The provider's state, in three: none configured, one configured but
 * missing credentials, or a working one reporting its last sync. Only
 * the last is a refresh button — the other two open Settings, which is
 * where the thing they're complaining about gets fixed.
 */
function ProviderSegment({
  sync: s,
  refreshing,
  onRefresh,
  onOpenSettings,
}: {
  sync: SyncState;
  refreshing: boolean;
  onRefresh: () => void;
  onOpenSettings: () => void;
}) {
  if (!s.providerId) {
    return (
      <Segment
        label="No VCS provider configured — open Settings"
        onClick={onOpenSettings}
      >
        <CloudOffIcon className="size-3" />
        No provider
      </Segment>
    );
  }
  if (!s.providerConfigured) {
    return (
      <Segment
        label={`${providerName(
          s.providerId
        )} needs credentials — open Settings`}
        onClick={onOpenSettings}
        className="text-warning"
      >
        <AlertCircleIcon className="size-3" />
        {providerName(s.providerId)} not configured
      </Segment>
    );
  }
  const syncing = refreshing || s.remoteSyncing;
  return (
    <Segment
      label={
        s.remoteError
          ? `Last sync failed: ${s.remoteError}`
          : `Refresh pull requests (auto every ${Math.round(
              s.remoteIntervalMs / 1000
            )}s)`
      }
      onClick={onRefresh}
      className={cn(s.remoteError && 'text-destructive')}
    >
      {syncing ? (
        <Loader2Icon className="size-3 animate-spin" />
      ) : s.remoteError ? (
        <AlertCircleIcon className="size-3" />
      ) : (
        <RefreshCwIcon className="size-3" />
      )}
      {providerName(s.providerId)}
      <span className="text-muted-foreground">
        {syncing
          ? 'syncing…'
          : s.lastRemoteSyncAt
          ? `synced ${relativeTime(s.lastRemoteSyncAt)}`
          : 'not synced'}
      </span>
    </Segment>
  );
}

/**
 * `3 machines`, or `3 machines · 1 unreachable` / `3 machines · 2 queued`
 * when something needs attention (unreachable takes priority — a fault
 * is more urgent than mail waiting). Hidden entirely with only the
 * local machine registered (D8): a user who never pairs anything sees
 * today's app.
 */
function MachinesSegment({
  machines,
  onOpenSettings,
}: {
  machines: MachineView[] | undefined;
  onOpenSettings: () => void;
}) {
  const others = (machines ?? []).filter((m) => !m.isLocal);
  if (others.length === 0) return null;

  const unreachable = others.filter((m) => m.state === 'unreachable').length;
  const queued = others.reduce((sum, m) => sum + m.queueDepth, 0);
  const count = others.length + 1; // + this machine

  let suffix = '';
  if (unreachable > 0) suffix = ` · ${unreachable} unreachable`;
  else if (queued > 0) suffix = ` · ${queued} queued`;

  return (
    <Segment
      label="Open Settings → Machines"
      onClick={onOpenSettings}
      className={unreachable > 0 ? 'text-warning' : undefined}
    >
      <MonitorIcon className="size-3" />
      {count} machine{count === 1 ? '' : 's'}
      {suffix}
    </Segment>
  );
}

function providerName(id: string): string {
  if (id === 'github') return 'GitHub';
  if (id === 'azure-devops') return 'Azure DevOps';
  return id;
}

function Segment({
  label,
  onClick,
  className,
  children,
}: {
  label: string;
  onClick?: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  const inner = (
    <span
      role={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'flex h-full items-center gap-1.5 px-1.5 transition-colors',
        onClick && 'cursor-pointer hover:bg-accent',
        className
      )}
    >
      {children}
    </span>
  );
  return <Tip label={label}>{inner}</Tip>;
}
