import { Button } from '../ui/button.js';
import { useLaunchTerminal } from '../../lib/data/mutations-terminals.js';
import { errorMessage } from '../../lib/utils.js';
import type { TerminalTab } from '../../lib/tabs/tabs.js';
import type { TerminalSummary } from '../../../host/contract.js';
import { useMachines, useTerminals } from '../../lib/data/queries.js';
import { SessionTerminal } from '../terminal/SessionTerminal.js';
import { ConnectionBanner } from '../terminal/ConnectionBanner.js';

/** A remote machine's peerId resolved to its label, for display —
 *  never the bare id, which means nothing to the user. Falls back to
 *  the id itself only if the machines list has not loaded yet. */
function machineLabelFor(
  machineId: string | undefined,
  machines: { peerId: string; label: string }[] | undefined
): string {
  return (
    machines?.find((m) => m.peerId === machineId)?.label ?? machineId ?? ''
  );
}

/** The exited-agent affordance ("Resume agent" / "Start new"). Gated
 *  entirely on `processState` (via `!session.running`), never on
 *  `connectionState` — a dropped connection must not show this. */
function ExitedAgentBar({ session }: { session: TerminalSummary }) {
  const launch = useLaunchTerminal();
  return (
    <div className="flex items-center gap-2 border-b px-3 py-2 text-sm">
      <span>{session.agent ?? 'Agent'} exited</span>
      <Button
        size="sm"
        disabled={launch.isPending}
        onClick={() =>
          launch.mutate({
            sessionName: session.name,
            kind: session.kind,
            cwd: session.cwd,
          })
        }
      >
        Resume agent
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={launch.isPending}
        onClick={() =>
          launch.mutate({
            sessionName: session.name,
            kind: session.kind,
            cwd: session.cwd,
            fresh: true,
          })
        }
      >
        Start new (directory default)
      </Button>
      {launch.error && <span role="alert">{errorMessage(launch.error)}</span>}
    </div>
  );
}

/**
 * A terminal tab's pane: the terminal, and nothing else. No rail, no
 * pull request bar, no diff — a shell in a folder has none of those.
 *
 * `epoch` is the session's spawn time from the host's listing, which is
 * what makes the pane re-fit when the process behind the name changes.
 */
export function TerminalView({
  tab,
  active,
}: {
  tab: TerminalTab;
  active: boolean;
}) {
  const terminals = useTerminals();
  const session = terminals.data?.find((t) => t.name === tab.name);
  const machines = useMachines();
  const epoch = session?.spawnedAt ?? 0;
  // The agent did not exit: processState (ExitedAgentBar, gated on
  // session.running) and connectionState are independent, and this
  // banner is driven by the latter only — AGENTS.md, ux-machines.md §6.
  const connectionState = session?.connectionState;
  const showBanner =
    connectionState === 'reconnecting' || connectionState === 'failed';
  return (
    <div className="relative flex min-h-0 flex-1 flex-col" data-terminal-pane>
      {showBanner && (
        <ConnectionBanner
          state={connectionState}
          machineLabel={machineLabelFor(session?.machine, machines.data)}
        />
      )}
      {session?.kind === 'agent' && !session.running && (
        <ExitedAgentBar session={session} />
      )}
      <div className="relative min-h-0 flex-1">
        <SessionTerminal name={tab.name} epoch={epoch} active={active} />
      </div>
    </div>
  );
}
