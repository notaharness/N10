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
    const needsProbe = this.targets().length > 0;
    if (needsProbe && !this.timer) {
      this.timer = setInterval(
        () => void this.probeAll(),
        this.options.intervalMs
      );
      this.timer.unref?.();
      void this.probeAll();
    } else if (!needsProbe && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
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
    let changed = false;
    await Promise.all(
      this.targets().map(async (peer) => {
        const result = await this.probeOne(peer);
        if (this.results.get(peer.peerId) !== result) changed = true;
        this.results.set(peer.peerId, result);
      })
    );
    if (changed) this.options.onChange();
    // A peer may have gained/lost its last endpoint, or connected,
    // between ticks — keep the timer's own condition honest.
    this.sync();
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
