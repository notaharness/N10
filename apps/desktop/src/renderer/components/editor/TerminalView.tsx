import { Button } from '../ui/button.js';
import { useLaunchTerminal } from '../../lib/data/mutations-terminals.js';
import { errorMessage } from '../../lib/utils.js';
import type { TerminalTab } from '../../lib/tabs/tabs.js';
import { useTerminals } from '../../lib/data/queries.js';
import { SessionTerminal } from '../terminal/SessionTerminal.js';

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
  const launch = useLaunchTerminal();
  const epoch = session?.spawnedAt ?? 0;
  return (
    <div className="relative flex min-h-0 flex-1 flex-col" data-terminal-pane>
      {session?.kind === 'agent' && !session.running && (
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
          {launch.error && (
            <span role="alert">{errorMessage(launch.error)}</span>
          )}
        </div>
      )}
      <div className="relative min-h-0 flex-1">
        <SessionTerminal name={tab.name} epoch={epoch} active={active} />
      </div>
    </div>
  );
}
