/**
 * What the desktop does when a probe finds a peer reachable and there is
 * mail waiting for it: dial — and what it does about one that keeps
 * refusing.
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

/** The most probe ticks a peer can be skipped for. At the node's 20s
 *  probe interval that is a retry every few minutes — often enough that
 *  a machine coming back, or a revocation being lifted, is noticed
 *  without anybody restarting anything, and rare enough that a peer
 *  which will refuse forever is not dialed forever. */
const MAX_SKIPPED_TICKS = 8;

/**
 * Dials peers that have mail waiting, when a probe finds them
 * reachable, and backs off the ones that refuse.
 *
 * A reachable peer with an empty queue is left alone, so the common case
 * costs one already-computed status read and no network at all. A peer
 * that refuses is the case worth remembering: a machine that has revoked
 * *us* answers the unauthenticated descriptor request the prober makes —
 * it is running, it is reachable — and then 403s the `/challenge` behind
 * every dial, for as long as the revocation stands. Without state, that
 * is a full pair-and-refuse round trip on every probe tick until
 * somebody forgets the peer, and the mail must stay queued the whole
 * time, because revocation can be lifted.
 *
 * The backoff is on failure generally, not on 403 in particular. A
 * refusal, a machine that answered a descriptor and then went away, and
 * a dial that timed out all want the same thing — try again, but not
 * immediately — and telling them apart would couple this to the shape of
 * an error string for no change in what it does.
 */
export class QueuedMailDialer {
  /** Per peer: how many consecutive dials have failed, and how many
   *  reachable ticks are still to be skipped before the next try. */
  private readonly backoff = new Map<
    string,
    { failures: number; skip: number }
  >();

  constructor(private readonly deps: QueuedMailDialDeps) {}

  /** `peerId` just answered a probe. */
  onReachable(peerId: string): void {
    if (this.deps.connections.get(peerId)) {
      this.backoff.delete(peerId);
      return;
    }
    const peer = this.deps.status().find((status) => status.peerId === peerId);
    if (!peer || peer.revoked || peer.queueDepth === 0) return;
    const waiting = this.backoff.get(peerId);
    if (waiting && waiting.skip > 0) {
      waiting.skip -= 1;
      return;
    }
    // A dial that fails is an ordinary outcome here. It is still
    // handled: an unhandled rejection out of a timer callback takes the
    // node down.
    void this.deps.connect(peerId).then(
      () => {
        this.backoff.delete(peerId);
        this.deps.log(`dialed ${peerId} to deliver ${peer.queueDepth} queued`);
      },
      (error: Error) => {
        const skipped = this.penalise(peerId);
        this.deps.log(
          `could not dial ${peerId} for queued mail: ${error.message}` +
            ` (skipping the next ${skipped} probes)`
        );
      }
    );
  }

  /** Forget what this peer owes — for a peer being forgotten, or one
   *  whose record changed enough that past refusals say nothing. */
  forget(peerId: string): void {
    this.backoff.delete(peerId);
  }

  private penalise(peerId: string): number {
    const failures = (this.backoff.get(peerId)?.failures ?? 0) + 1;
    const skip = Math.min(2 ** (failures - 1), MAX_SKIPPED_TICKS);
    this.backoff.set(peerId, { failures, skip });
    return skip;
  }
}
