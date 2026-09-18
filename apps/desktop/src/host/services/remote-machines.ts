/**
 * The main-process face of the beam node's remote-machine capability:
 * running a command on another machine (a `MachineExecutor`) and
 * attaching an interactive `pty` stream to it (a `RemotePtyOpener`).
 * Both are what `@n10/core`'s `setMachineResolver` (installed in
 * `main.ts`) needs to hand `open-session.ts`'s remote branch (D4, D5).
 *
 * No `electron` import here, so this stays testable with a fake port —
 * same pattern as `services/machines.ts`. The real port is the beam
 * node bridge (`main/beam-node-bridge.ts`), installed once at startup.
 */
import { setMachineResolver } from '@n10/core';
import type {
  MachineExecutor,
  RemoteMachine,
  RemotePtyHandle,
  RemotePtyOpener,
} from '@n10/terminal-tmux';

export type StreamEventPayload =
  | { kind: 'data'; streamId: string; data: string }
  | { kind: 'closed'; streamId: string };

export interface RemoteMachinePort {
  execOn(
    peerId: string,
    argv: string[],
    opts?: { cwd?: string; env?: Record<string, string>; stdin?: string }
  ): Promise<{ stdout: string; stderr: string; code: number }>;
  ptyOpen(
    peerId: string,
    params: {
      argv?: string[];
      cwd?: string;
      env?: Record<string, string>;
      cols?: number;
      rows?: number;
    }
  ): Promise<{ streamId: string }>;
  ptyWrite(streamId: string, data: string): void;
  ptyResize(streamId: string, cols: number, rows: number): void;
  ptyClose(streamId: string): void;
  onPtyEvent(cb: (event: StreamEventPayload) => void): () => void;
}

let port: RemoteMachinePort | null = null;

/** Installed by `beam-node-bridge.ts` once the utility-process bridge
 *  is up. `null` (the default, and what tests reset to) means "no
 *  remote machines" — `machineFor` throws rather than silently
 *  returning something that looks like a working machine. */
export function setRemoteMachinePort(next: RemoteMachinePort | null): void {
  port = next;
}

function requirePort(): RemoteMachinePort {
  if (!port) throw new Error('remote machines are not available yet');
  return port;
}

function executorFor(peerId: string): MachineExecutor {
  return {
    run: (argv, opts) => requirePort().execOn(peerId, argv, opts),
  };
}

/** One `RemotePtyHandle` per open call: subscribes to the shared
 *  `onPtyEvent` stream and filters to its own `streamId`, so multiple
 *  concurrent remote sessions on one machine do not cross wires. */
async function openPty(
  peerId: string,
  params: Parameters<RemotePtyOpener['open']>[0]
): Promise<RemotePtyHandle> {
  const { streamId } = await requirePort().ptyOpen(peerId, params);
  const dataCbs = new Set<(data: string) => void>();
  const closeCbs = new Set<() => void>();
  const off = requirePort().onPtyEvent((event) => {
    if (event.streamId !== streamId) return;
    if (event.kind === 'data') {
      for (const cb of dataCbs) cb(event.data);
    } else {
      for (const cb of closeCbs) cb();
      off();
    }
  });
  return {
    onData: (cb) => dataCbs.add(cb),
    offData: (cb) => dataCbs.delete(cb),
    write: (data) => requirePort().ptyWrite(streamId, data),
    resize: (cols, rows) => requirePort().ptyResize(streamId, cols, rows),
    onClose: (cb) => closeCbs.add(cb),
    dispose: () => {
      requirePort().ptyClose(streamId);
      off();
    },
  };
}

/** Builds the `RemoteMachine` `@n10/core`'s machine resolver hands
 *  `open-session.ts` for `peerId`. Throws if no port is installed —
 *  the caller (`main.ts`'s resolver) turns that into "machine not
 *  available" rather than a silent local fallback. */
export function machineFor(peerId: string): RemoteMachine {
  requirePort();
  return {
    id: peerId,
    executor: executorFor(peerId),
    ptyOpener: { open: (params) => openPty(peerId, params) },
  };
}

/** Installs `machineFor` as `@n10/core`'s machine resolver. Call once
 *  at startup, after `setRemoteMachinePort`. A machine that cannot be
 *  constructed (no port installed, or an unknown peerId) resolves to
 *  undefined, never a fallback machine -- `requireMachine` in
 *  `@n10/core` then throws loudly, which is what stops a remote-machine
 *  launch from quietly running locally. */
export function installMachineResolver(): void {
  setMachineResolver((peerId) => {
    try {
      return machineFor(peerId);
    } catch {
      return undefined;
    }
  });
}
