import type { AppConfig } from '@n10/vcs-core';
import type { NamedPtyEntry } from '../pty-registry.js';
import { buildAgentLaunch } from '../session/launch-session.js';
import { openSession } from '../session/open-session.js';
import type { MachineEnvRequest } from '../session/machine-env.js';
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
  /** What the session wants from the machine it runs on — see
   *  `machine-env.ts`. */
  machine?: MachineEnvRequest;
  cwd: string;
  cols: number;
  rows: number;
  config: AppConfig;
}

/** Terminal intent is explicit in core; no tags are used as internal flags. */
export async function launchTerminalSession(
  params: TerminalLaunchParams
): Promise<NamedPtyEntry> {
  const key = params.name ? sessionIdentity(params.name) : null;
  if (params.name && key?.kind !== 'terminal')
    throw new Error('Expected a qualified terminal key');
  return openSession({
    session: {
      type: 'terminal',
      kind: params.kind,
      repo: getRepoRoot() ?? params.cwd,
      target: key?.kind === 'terminal' ? key.id : undefined,
    },
    mode: params.name ? params.mode : 'create',
    fresh: params.kind === 'agent' && params.fresh,
    intent: params.kind === 'agent' && params.fresh ? 'fresh' : 'continue',
    machine: params.machine,
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
