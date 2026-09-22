/**
 * Where `libs/core` learns about remote machines, without depending on
 * beam or Electron. Mirrors `@n10/terminal-tmux`'s own
 * `setTmuxSessionPreparer` seam: a callback the desktop installs once
 * its beam bridge is up (`apps/desktop/src/main/main.ts`), never called
 * by the TUI or the CLI, which have no remote-machine capability this
 * phase.
 *
 * `open-session.ts` is the one place this is consulted, branching on
 * the machine in a `SessionRequest` — see decisions.md D4/D5.
 */
import { RemoteSessionPoller, type RemoteMachine } from '@n10/terminal-tmux';
import { LOCAL_MACHINE } from './session-key.js';

export type MachineResolver = (machineId: string) => RemoteMachine | undefined;

let resolver: MachineResolver | null = null;
const pollers = new Map<string, RemoteSessionPoller>();

/** Installed once, or cleared (`null`) on shutdown/test teardown. A
 *  fresh resolver may back different executors than the last one, so
 *  any cached poller is dropped rather than reused across it. */
export function setMachineResolver(fn: MachineResolver | null): void {
  resolver = fn;
  for (const poller of pollers.values()) poller.dispose();
  pollers.clear();
}

export function resolveMachine(machineId: string): RemoteMachine | undefined {
  if (machineId === LOCAL_MACHINE) return undefined;
  return resolver?.(machineId);
}

/**
 * Throws rather than silently falling back to the local repository —
 * "the one thing that must not happen" (root AGENTS.md). Every
 * machine-aware call in `open-session.ts` goes through this rather
 * than checking `resolveMachine` and quietly doing something else when
 * it comes back empty.
 */
export function requireMachine(machineId: string): RemoteMachine {
  const machine = resolveMachine(machineId);
  if (!machine)
    throw new Error(
      `Machine "${machineId}" is not available (not paired, not connected, or this session cannot reach remote machines).`
    );
  return machine;
}

/** D3: one poller per machine, cached across calls so repeated opens on
 *  the same machine fan out through the same ~1s interval rather than
 *  starting a redundant one. */
export function pollerFor(machine: RemoteMachine): RemoteSessionPoller {
  let poller = pollers.get(machine.id);
  if (!poller) {
    poller = new RemoteSessionPoller(machine.executor);
    pollers.set(machine.id, poller);
  }
  return poller;
}
