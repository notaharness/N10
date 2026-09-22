/**
 * Reachability probing — D6's `reachable`/`unreachable` split, observed
 * rather than assumed. Split out of `beam-node.ts` (a catalogue
 * already) because it is one self-contained subject: a timer plus a
 * cache of the last probe result per peer.
 *
 * Only peers with an endpoint and no live connection are ever probed —
 * a connected peer's state comes from the connection itself, and a
 * peer with no endpoint cannot be dialed at all (`no-endpoint`, not a
 * probe result). The timer itself only runs while there is something
 * to probe, so a user who has paired nothing pays no background cost
 * (D8).
 */
import {
  fetchDescriptor,
  type ConnectionRegistry,
  type PeerRecord,
  type PeerTable,
} from '@n10/beam';
import { withTimeout } from './beam-node-errors.js';

export interface ReachabilityProberOptions {
  peers: PeerTable;
  connections: ConnectionRegistry;
  intervalMs: number;
  timeoutMs: number;
  /** Called after a probe changes what a peer's state would be. */
  onChange: () => void;
  /**
   * Called for every peer a probe just found reachable — including one
   * that was already reachable at the last tick, because a caller that
   * acts on this (dialing a peer with mail waiting) may have failed to
   * and needs the next chance, and a peer that got connected is not a
   * probe target any more anyway.
   *
   * Reachability is the only moment the desktop learns anything about a
   * peer it is not connected to: nothing here ever dials, so without
   * this a node with queued mail and a peer showing "Reachable" waits
   * for a connection nobody is going to make.
   */
  onReachable?: (peerId: string) => void;
}

export class ReachabilityProber {
  private readonly results = new Map<string, 'reachable' | 'unreachable'>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly options: ReachabilityProberOptions) {}

  get(peerId: string): 'reachable' | 'unreachable' | undefined {
    return this.results.get(peerId);
  }

  forget(peerId: string): void {
    this.results.delete(peerId);
  }

  /** Call after anything that might change who needs probing: a
   *  pairing, a revoke, a forget, a connect or a disconnect. */
  sync(): void {
    const targets = this.targets();
    if (targets.length > 0 && !this.timer) {
      this.timer = setInterval(
        () => void this.probeAll(),
        this.options.intervalMs
      );
      this.timer.unref?.();
    } else if (targets.length === 0 && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    // A target with no result yet is a machine the UI is showing as
    // "Checking…" this moment — usually one just paired. Resolve those
    // now rather than at the next tick, a whole interval away. Targets
    // that already have a result belong to the timer, so a sync that
    // gains nothing (a revoke, a disconnect of someone else) costs no
    // network.
    const unresolved = targets.filter((p) => !this.results.has(p.peerId));
    if (unresolved.length > 0) void this.probe(unresolved);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private targets(): PeerRecord[] {
    return this.options.peers
      .list()
      .filter(
        (p) =>
          !p.revoked &&
          p.endpoints.length > 0 &&
          this.options.connections.get(p.peerId) === undefined
      );
  }

  private async probeAll(): Promise<void> {
    await this.probe(this.targets());
    // A peer may have gained/lost its last endpoint, or connected,
    // between ticks — keep the timer's own condition honest.
    this.sync();
  }

  private async probe(peers: readonly PeerRecord[]): Promise<void> {
    let changed = false;
    const reachable: string[] = [];
    await Promise.all(
      peers.map(async (peer) => {
        const result = await this.probeOne(peer);
        if (this.results.get(peer.peerId) !== result) changed = true;
        this.results.set(peer.peerId, result);
        if (result === 'reachable') reachable.push(peer.peerId);
      })
    );
    if (changed) this.options.onChange();
    for (const peerId of reachable) this.options.onReachable?.(peerId);
  }

  private async probeOne(
    peer: PeerRecord
  ): Promise<'reachable' | 'unreachable'> {
    for (const endpoint of peer.endpoints) {
      try {
        const descriptor = await withTimeout(
          fetchDescriptor(endpoint),
          this.options.timeoutMs
        );
        if (descriptor.peerId === peer.peerId) return 'reachable';
      } catch {
        // Try the next endpoint before giving up.
      }
    }
    return 'unreachable';
  }
}
