import { Button } from '../ui/button.js';
import {
  useLaunchTerminal,
  useReconnectSession,
} from '../../lib/data/mutations-terminals.js';
import { resolveMachineLabel } from '../../lib/machines/machine-model.js';
import { terminalPaneState } from '../../lib/terminals/terminal-pane-state.js';
import { errorMessage } from '../../lib/utils.js';
import type { TerminalTab } from '../../lib/tabs/tabs.js';
import type { TerminalSummary } from '../../../host/contract.js';
import { useMachines, useTerminals } from '../../lib/data/queries.js';
import { SessionTerminal } from '../terminal/SessionTerminal.js';
import { ConnectionBanner } from '../terminal/ConnectionBanner.js';

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
  const reconnect = useReconnectSession();
  const epoch = session?.spawnedAt ?? 0;
  // processState (ExitedAgentBar) and connectionState (the banner) are
  // independent by construction — terminalPaneState pins that, so a
  // dropped connection can never read as the agent having exited
  // (AGENTS.md, ux-machines.md §6). No listing yet: nothing to show.
  const pane = session
    ? terminalPaneState(session)
    : { bannerState: null, inputDisabled: false, showExitedBar: false };
  return (
    <div className="relative flex min-h-0 flex-1 flex-col" data-terminal-pane>
      {pane.bannerState && (
        <ConnectionBanner
          state={pane.bannerState}
          machineLabel={
            resolveMachineLabel(session?.machine, machines.data) ??
            'this machine'
          }
          onReconnect={() => reconnect.mutate(tab.name)}
          reconnecting={reconnect.isPending}
        />
      )}
      {pane.showExitedBar && session && <ExitedAgentBar session={session} />}
      <div className="relative min-h-0 flex-1">
        <SessionTerminal
          name={tab.name}
          epoch={epoch}
          active={active}
          disabled={pane.inputDisabled}
        />
      </div>
    </div>
  );
}
