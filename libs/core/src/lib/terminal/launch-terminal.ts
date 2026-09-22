import type { AppConfig } from '@n10/vcs-core';
import type { NamedPtyEntry } from '../pty-registry.js';
import { buildAgentLaunch } from '../session/launch-session.js';
import { openSession } from '../session/open-session.js';
import { sessionIdentity } from '../session-key.js';
import { getRepoRoot } from '../repo-root.js';
import type { TerminalKind } from './terminal-name.js';

export interface TerminalLaunchParams {
  /** Existing qualified terminal key. Omit to create a new terminal. */
  name?: string;
  mode?: 'open' | 'attach';
  /** Start a fresh conversation with the directory's configured agent. */
  fresh?: boolean;
  kind: TerminalKind;
  cwd: string;
  cols: number;
  rows: number;
  config: AppConfig;
  /** A beam peerId, or omitted for local (decisions.md D2). Only
   *  meaningful for a fresh terminal — `params.name`, when qualified
   *  (D2's key), already carries whatever machine it was created on. */
  machine?: string;
}

/** A restart's key (when qualified) always wins over the request's own
 *  `machine`: a retained terminal already lives on whatever machine it
 *  was created on. Split out to keep `launchTerminalSession`'s own
 *  complexity within budget. */
function terminalIdentity(params: TerminalLaunchParams) {
  const key = params.name ? sessionIdentity(params.name) : null;
  if (params.name && key?.kind !== 'terminal')
    throw new Error('Expected a qualified terminal key');
  return {
    target: key?.kind === 'terminal' ? key.id : undefined,
    machine: key?.kind === 'terminal' ? key.machine : params.machine,
  };
}

/** Terminal intent is explicit in core; no tags are used as internal flags. */
export async function launchTerminalSession(
  params: TerminalLaunchParams
): Promise<NamedPtyEntry> {
  const identity = terminalIdentity(params);
  return openSession({
    session: {
      type: 'terminal',
      kind: params.kind,
      repo: getRepoRoot() ?? params.cwd,
      target: identity.target,
      machine: identity.machine,
    },
    mode: params.name ? params.mode : 'create',
    fresh: params.kind === 'agent' && params.fresh,
    intent: params.kind === 'agent' && params.fresh ? 'fresh' : 'continue',
    cwd: params.cwd,
    cols: params.cols,
    rows: params.rows,
    build: (previous, restarting) =>
      params.kind === 'shell'
        ? { spec: { cmd: '', args: [] } }
        : buildAgentLaunch(
            {
              config: params.config,
              request: { intent: params.fresh ? 'blank' : 'continue-or-blank' },
            },
            previous,
            restarting
          ),
  });
}
