import type {
  TerminalKind,
  TerminalLaunchRequest,
} from '../../../host/contract.js';

/**
 * The request `useTerminalTabs.launchTerminal` sends the host, split
 * out as a pure function so the local shape can be pinned in a test
 * without touching React or TanStack Query.
 *
 * A local launch (no `machine`) sends exactly what it sent before this
 * phase — no `machine`, no `launchId` — because that is D8: the
 * overwhelming majority of users who never pair anything must see no
 * trace of this feature, request payloads included.
 */
/**
 * What "open a terminal on `<machine>`" (the command palette's quick
 * action, which asks for no directory) sends as `cwd` for a remote
 * launch. `''` used to travel verbatim — not absolute, not `~/`, so
 * `assertLaunchableCwd` would have refused it outright were this a
 * local launch, and for a remote one (which skips that check — this
 * machine cannot `statSync` another machine's filesystem) it simply
 * failed on the far side instead, loudly but for an untested, unnamed
 * reason. The remote user's home is the explicit meaning: docs/beam.md
 * already documents a leading `~/` as expanded by the accepting
 * machine, so this is not a new contract, only naming what "no
 * directory chosen" means instead of leaving it blank (finding 5).
 */
export const REMOTE_HOME_CWD = '~/';

export function terminalLaunchRequest(
  kind: TerminalKind,
  cwd: string,
  pane: { cols?: number; rows?: number },
  machine?: string,
  launchId?: string
): TerminalLaunchRequest {
  if (!machine) return { kind, cwd, ...pane };
  return { kind, cwd, machine, launchId, ...pane };
}
