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

const node = new BeamNode();

function post(message: BeamWorkerMessage): void {
  process.parentPort.postMessage(message);
}

node.onChange((machines) => {
  post({ kind: 'event', name: 'changed', payload: machines });
});

const OPS: Record<string, (payload: unknown) => Promise<unknown> | unknown> = {
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
  shutdown: () => node.dispose(),
};

process.parentPort.on('message', ({ data }: { data: BeamNodeRequest }) => {
  void handle(data);
});

async function handle(request: BeamNodeRequest): Promise<void> {
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
