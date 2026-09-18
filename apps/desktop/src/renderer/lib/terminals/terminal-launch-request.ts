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
