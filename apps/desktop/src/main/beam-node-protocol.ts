/**
 * Wire shape between `beam-node-bridge.ts` (main) and
 * `beam-node-worker.ts` (the utility process): a correlated
 * request/response call, plus an event channel for pushes the worker
 * makes on its own (the node changed). Declared once, imported by both
 * sides — same reason `contract.ts`'s `IPC` map is declared once.
 *
 * Kept deliberately narrow and JSON-serializable: everything that
 * crosses `utilityProcess.postMessage` must survive structured clone.
 */

export interface BeamNodeRequest {
  id: number;
  op: string;
  payload?: unknown;
}

export type BeamWorkerMessage =
  | { kind: 'response'; id: number; ok: true; result: unknown }
  | { kind: 'response'; id: number; ok: false; error: string }
  | { kind: 'event'; name: 'changed'; payload: unknown };
