/**
 * What the desktop does when a probe finds a peer reachable and there is
 * mail waiting for it: dial.
 *
 * `send()` promises that queued mail goes out "the next time that
 * machine comes online", and the mailbox's flush triggers — a connection
 * becoming live, node start, a retry while connected — all need a
 * connection that something has to make. Nothing in the desktop ever
 * made one: the reachability prober fetches a descriptor over HTTP and
 * stops there, and `ConnectionRegistry` only ever gains connections
 * somebody opened for an op of their own. So a desktop holding queued
 * mail for a peer showing "Reachable" waited indefinitely for a trigger
 * that was never going to fire.
 *
 * Split out of `beam-node.ts` (a catalogue already, and at its line
 * budget) for the same reason `beam-node-probe.ts` was: this is one
 * self-contained decision, and one worth testing on its own.
 */
import type { ConnectionRegistry, PeerStatus } from '@n10/beam';

export interface QueuedMailDialDeps {
  connections: Pick<ConnectionRegistry, 'get'>;
  /** The mailbox's per-peer view, including its outbound queue depth. */
  status: () => PeerStatus[];
  /** Ensure a live connection to this peer, dialing if there is none.
   *  Routed through `RemoteOps` so this shares the one in-flight dial
   *  per peer with everything else that wants that machine back. */
  connect: (peerId: string) => Promise<unknown>;
  log: (message: string) => void;
}

/**
 * Dial `peerId` if — and only if — it has mail waiting. A reachable peer
 * with an empty queue is left alone, so the common case costs one
 * already-computed status read and no network at all.
 */
export function dialIfMailIsWaiting(
  peerId: string,
  deps: QueuedMailDialDeps
): void {
  if (deps.connections.get(peerId)) return;
  const peer = deps.status().find((status) => status.peerId === peerId);
  if (!peer || peer.revoked || peer.queueDepth === 0) return;
  // A dial that fails is an ordinary outcome here — the machine answered
  // a descriptor request and then refused a connection, or went away in
  // between — and the next probe tries again. It is still handled: an
  // unhandled rejection out of a timer callback takes the node down.
  void deps.connect(peerId).then(
    () => deps.log(`dialed ${peerId} to deliver ${peer.queueDepth} queued`),
    (error: Error) =>
      deps.log(`could not dial ${peerId} for queued mail: ${error.message}`)
  );
}
