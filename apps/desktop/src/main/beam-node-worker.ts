/**
 * The beam node's utility-process entry point. Tiny by design, mirroring
 * `tmux-session-worker.ts`: all the actual logic lives in `beam-node.ts`
 * (pure Node, independently testable), and this file is only the
 * `process.parentPort` wiring — request/response by correlation id, plus
 * an event channel for pushes. See `beam-node-bridge.ts` for the main
 * side and decisions.md D10 for why this whole node runs here rather
 * than in the main process.
 */
import { BeamNode } from './beam-node.js';
import type {
  BeamNodeRequest,
  BeamWorkerMessage,
} from './beam-node-protocol.js';

function post(message: BeamWorkerMessage): void {
  process.parentPort.postMessage(message);
}

function startupErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * `BeamNode`'s constructor does synchronous disk I/O
 * (`loadOrCreateIdentity`, `PeerTable`, `Mailbox` — see `beam-node.ts`),
 * so an unreadable or corrupt `$BEAM_DIR` throws here, at module load.
 * Left uncaught, that crashes the whole utility process before it can
 * say why, and `beam-node-bridge.ts`'s restart-on-exit would just fork
 * a fresh worker into the exact same throw — a tight loop with nothing
 * to break it (finding 2). Catching it here instead keeps the process
 * alive: every request gets an honest, specific failure instead of a
 * bare exit code, and there is no exit for the bridge to react to at
 * all, so this failure mode needs no restart policy of its own.
 */
function createNode(): { node: BeamNode } | { error: string } {
  try {
    return { node: new BeamNode() };
  } catch (error) {
    return { error: startupErrorMessage(error) };
  }
}

const started = createNode();

if ('node' in started) {
  const { node } = started;
  node.onChange((machines) => {
    post({ kind: 'event', name: 'changed', payload: machines });
  });
  node.remote.onStreamEvent((event) => {
    if (event.kind === 'data')
      post({
        kind: 'event',
        name: 'pty-data',
        payload: { streamId: event.streamId, data: event.data },
      });
    else
      post({
        kind: 'event',
        name: 'pty-closed',
        payload: { streamId: event.streamId },
      });
  });
  node.mail.onMail((event) => {
    post({ kind: 'event', name: 'mail-inbound', payload: event });
  });
} else {
  post({
    kind: 'event',
    name: 'startup-failed',
    payload: { message: started.error },
  });
}

function buildOps(
  node: BeamNode
): Record<string, (payload: unknown) => Promise<unknown> | unknown> {
  return {
    listMachines: () => node.listMachines(),
    getAcceptingStatus: () => node.getAcceptingStatus(),
    setAccepting: (payload) =>
      (payload as { enabled: boolean }).enabled
        ? node.startAccepting()
        : node.stopAccepting(),
    regeneratePairingUrl: () => node.regeneratePairingUrl(),
    previewPairing: (payload) =>
      node.previewPairing((payload as { url: string }).url),
    confirmPairing: (payload) => {
      const p = payload as { url: string; force: boolean };
      return node.confirmPairing(p.url, p.force);
    },
    renameMachine: (payload) => {
      const p = payload as { peerId: string; label: string };
      return node.renameMachine(p.peerId, p.label);
    },
    revokeMachine: (payload) =>
      node.revokeMachine((payload as { peerId: string }).peerId),
    forgetMachine: (payload) =>
      node.forgetMachine((payload as { peerId: string }).peerId),
    execOn: (payload) => {
      const p = payload as {
        peerId: string;
        argv: string[];
        cwd?: string;
        env?: Record<string, string>;
        stdin?: string;
      };
      return node.remote.execOn(p.peerId, p.argv, {
        cwd: p.cwd,
        env: p.env,
        stdin: p.stdin,
      });
    },
    ptyOpen: (payload) => {
      const p = payload as {
        peerId: string;
        argv?: string[];
        cwd?: string;
        env?: Record<string, string>;
        cols?: number;
        rows?: number;
      };
      return node.remote.ptyOpen(p.peerId, {
        argv: p.argv,
        cwd: p.cwd,
        env: p.env,
        cols: p.cols,
        rows: p.rows,
      });
    },
    ptyWrite: (payload) => {
      const p = payload as { streamId: string; data: string };
      node.remote.ptyWrite(p.streamId, p.data);
    },
    ptyResize: (payload) => {
      const p = payload as { streamId: string; cols: number; rows: number };
      node.remote.ptyResize(p.streamId, p.cols, p.rows);
    },
    ptyClose: (payload) => {
      node.remote.ptyClose((payload as { streamId: string }).streamId);
    },
    ackMail: (payload) => node.mail.ack((payload as { id: string }).id),
    shutdown: () => node.dispose(),
  };
}

const OPS = 'node' in started ? buildOps(started.node) : {};

process.parentPort.on('message', ({ data }: { data: BeamNodeRequest }) => {
  void handle(data);
});

async function handle(request: BeamNodeRequest): Promise<void> {
  if (!('node' in started)) {
    post({
      kind: 'response',
      id: request.id,
      ok: false,
      error: `beam node failed to start: ${started.error}`,
    });
    return;
  }
  const op = OPS[request.op];
  if (!op) {
    post({
      kind: 'response',
      id: request.id,
      ok: false,
      error: `unknown op: ${request.op}`,
    });
    return;
  }
  try {
    const result = await op(request.payload);
    post({ kind: 'response', id: request.id, ok: true, result });
  } catch (error) {
    post({
      kind: 'response',
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    if (request.op === 'shutdown') setImmediate(() => process.exit(0));
  }
}
