/**
 * The desktop's beam node: identity, the peer table, accepting
 * connections, dialing out to pair, and reachability probing. Pure
 * Node — no Electron import — so it is unit-testable without a
 * utility process, and so `beam-node-worker.ts` (the tiny Electron
 * entry point that actually runs it) stays a thin wrapper.
 *
 * decisions.md D10 is why this whole thing runs inside a utility
 * process in production (`beam-node-worker.ts` +
 * `beam-node-bridge.ts`): a beam-served `pty`/`exec` stream spawns a
 * child process on behalf of whatever the remote caller asked for, and
 * that cannot be classified as short-lived the way `TmuxBackend`'s
 * node-pty client is — see `tmux-session-worker.ts` for the sibling
 * pattern this follows.
 */

import {
  ConnectionRegistry,
  createExecStreamHandler,
  createPtyStreamHandler,
  dial as beamDial,
  fetchDescriptor,
  Host,
  loadOrCreateIdentity,
  Mailbox,
  pair as beamPair,
  parsePairUrl,
  PAIRING_TOKEN_TTL_MS,
  PeerTable,
  PROTOCOL_VERSION,
  renameIdentity,
  resolveBeamDir,
  StreamRegistry,
  type Identity,
  type NodeEnvContext,
  type PeerRecord,
} from '@n10/beam';
import type {
  AcceptingStatus,
  MachineView,
  PairConfirmResult,
  PairPreviewResult,
} from '../host/contract-machines.js';
import { classifyPairError, withTimeout } from './beam-node-errors.js';
import { ReachabilityProber } from './beam-node-probe.js';
import { localMachineView, peerMachineView } from './beam-node-view.js';
import { RemoteOps } from './beam-node-remote-ops.js';
import { InboundMailSubscriber } from './beam-node-mail.js';
export type { StreamEvent } from './beam-node-remote-ops.js';
export type { InboundMailEvent } from './beam-node-mail.js';

export interface BeamNodeOptions {
  /** Overridable for tests; defaults to the real `$BEAM_DIR`. */
  beamDir?: string;
  now?: () => number;
  /** How often an endpoint with no live connection is probed. */
  probeIntervalMs?: number;
  probeTimeoutMs?: number;
  hostname?: () => string;
  log?: (message: string) => void;
}

const DEFAULT_PROBE_INTERVAL_MS = 20_000;
const DEFAULT_PROBE_TIMEOUT_MS = 5_000;

/**
 * One beam node per app instance. Constructing it loads (or creates)
 * this machine's identity and peer table, but does nothing over the
 * network: accepting is opt-in (`startAccepting`), and probing only
 * runs while at least one peer has an endpoint to probe.
 */
export class BeamNode {
  private identity: Identity;
  private readonly beamDir: string;
  private readonly peers: PeerTable;
  private readonly connections = new ConnectionRegistry();
  private readonly registry = new StreamRegistry();
  private readonly mailbox: Mailbox;
  private readonly now: () => number;
  private readonly log: (message: string) => void;
  private readonly probeTimeoutMs: number;
  private readonly prober: ReachabilityProber;
  private host: Host | null = null;
  private pairingUrl: string | null = null;
  private pairingExpiresAt: number | null = null;
  private readonly listeners = new Set<(machines: MachineView[]) => void>();
  /** Remote-machine ops (D4/D5): a `MachineExecutor` (`execOn`) and a
   *  pty stream opener, implemented in `beam-node-remote-ops.ts`.
   *  Public so the worker's OPS table can call it directly rather than
   *  BeamNode re-declaring every method as a one-line delegation. */
  readonly remote: RemoteOps;
  /** The subscriber side of the desktop's mailbox relay (D13/D14): every
   *  inbound envelope this node accepts is pushed here and held unacked
   *  until `mail.ack(id)` is called — `beam-node-worker.ts` forwards
   *  events to the bridge, and `beam-mail-relay.ts` in main is what
   *  resolves a target and calls back with the ack once delivery
   *  actually succeeds. Public for the same reason `remote` is. */
  readonly mail: InboundMailSubscriber;
  private disposed = false;

  constructor(options: BeamNodeOptions = {}) {
    this.now = options.now ?? Date.now;
    this.log = options.log ?? (() => undefined);
    this.probeTimeoutMs = options.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
    this.beamDir = options.beamDir ?? resolveBeamDir();
    this.identity = loadOrCreateIdentity(
      this.beamDir,
      options.hostname ? { hostname: options.hostname } : undefined
    );
    this.peers = new PeerTable(this.beamDir, { now: this.now });
    this.registry.register('pty', createPtyStreamHandler(this.envContext()));
    this.registry.register('exec', createExecStreamHandler(this.envContext()));
    this.mailbox = new Mailbox({
      identity: this.identity,
      peers: this.peers,
      connections: this.connections,
      registry: this.registry,
      beamDir: this.beamDir,
      now: this.now,
      log: this.log,
    });
    this.prober = new ReachabilityProber({
      peers: this.peers,
      connections: this.connections,
      intervalMs: options.probeIntervalMs ?? DEFAULT_PROBE_INTERVAL_MS,
      timeoutMs: options.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS,
      onChange: () => this.notify(),
    });
    this.connections.onConnect(() => this.notify());
    this.connections.onDisconnect(() => this.notify());
    this.prober.sync();
    this.remote = new RemoteOps({
      getIdentity: () => this.identity,
      peers: this.peers,
      connections: this.connections,
      registry: this.registry,
    });
    this.mail = new InboundMailSubscriber(this.mailbox, this.peers);
  }

  private envContext(): NodeEnvContext {
    return {
      beamDir: this.beamDir,
      // No local IPC socket from the desktop node yet — that is the
      // CLI's `$BEAM_DIR/run/inbox.sock`, not something this node
      // stands up. A child spawned here still learns BEAM_PEER_ID etc.
      inboxSocketPath: '',
      ownPeerId: this.identity.peerId,
    };
  }

  private advertisedEndpoints(): string[] {
    return this.host ? [`http://${this.host.hostname}:${this.host.port}`] : [];
  }

  onChange(cb: (machines: MachineView[]) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private notify(): void {
    if (this.disposed) return;
    const machines = this.listMachines();
    for (const cb of this.listeners) cb(machines);
  }

  listMachines(): MachineView[] {
    const local = localMachineView(
      this.identity.peerId,
      this.identity.label,
      this.advertisedEndpoints()
    );
    const records = new Map<string, PeerRecord>(
      this.peers.list().map((p) => [p.peerId, p])
    );
    const peers = this.mailbox
      .status()
      .map((status): MachineView | null => {
        const record = records.get(status.peerId);
        if (!record) return null;
        const connection = this.connections.get(status.peerId);
        return peerMachineView(
          status,
          record,
          connection !== undefined,
          this.prober.get(status.peerId)
        );
      })
      .filter((m): m is MachineView => m !== null)
      .sort((a, b) => a.label.localeCompare(b.label));
    return [local, ...peers];
  }

  getAcceptingStatus(): AcceptingStatus {
    return {
      accepting: this.host !== null,
      boundAddress: this.host
        ? `${this.host.hostname}:${this.host.port}`
        : null,
      pairingUrl: this.pairingUrl,
      pairingExpiresAt: this.pairingExpiresAt,
      connectedCount: this.connections.list().length,
    };
  }

  async startAccepting(): Promise<AcceptingStatus> {
    if (!this.host) {
      const host = new Host({
        identity: this.identity,
        peers: this.peers,
        registry: this.registry,
        connections: this.connections,
        // Default bind is loopback (docs/beam.md's security posture) —
        // the desktop does not yet offer a non-default interface.
        hostname: '127.0.0.1',
        port: 0,
        now: this.now,
        log: this.log,
      });
      await host.listen();
      // Only known once listening (an ephemeral `port: 0` resolves here) —
      // this is what a pairing caller is told back as where it may dial us.
      host.setEndpoints([host.baseUrl]);
      this.host = host;
    }
    this.mintPairingUrl();
    this.notify();
    return this.getAcceptingStatus();
  }

  /**
   * Stop accepting *new* connections. Whether this drops connections
   * already open is a property of `Host.close()`, not a UI choice — it
   * does, so the copy above this must say so (the UX spec explicitly
   * allows either behaviour as long as the copy matches it).
   */
  async stopAccepting(): Promise<AcceptingStatus> {
    if (this.host) {
      await this.host.close();
      this.host = null;
    }
    this.pairingUrl = null;
    this.pairingExpiresAt = null;
    this.notify();
    return this.getAcceptingStatus();
  }

  regeneratePairingUrl(): AcceptingStatus {
    if (!this.host) throw new Error('not accepting connections');
    this.mintPairingUrl();
    this.notify();
    return this.getAcceptingStatus();
  }

  private mintPairingUrl(): void {
    if (!this.host) return;
    const { url } = this.host.issuePairingUrl();
    this.pairingUrl = url;
    this.pairingExpiresAt = this.now() + PAIRING_TOKEN_TTL_MS;
  }

  /** Step 1: fetch what a pairing URL names, without spending its token
   *  or storing anything — the two-step confirm's whole security value. */
  async previewPairing(url: string): Promise<PairPreviewResult> {
    try {
      const { baseUrl } = parsePairUrl(url);
      const descriptor = await withTimeout(
        fetchDescriptor(baseUrl),
        this.probeTimeoutMs
      );
      if (descriptor.protocol !== PROTOCOL_VERSION) {
        return {
          ok: false,
          failure: {
            reason: 'protocol-mismatch',
            message: `That machine speaks beam protocol ${descriptor.protocol}; this one speaks ${PROTOCOL_VERSION}.`,
          },
        };
      }
      return {
        ok: true,
        preview: {
          label: descriptor.label,
          peerId: descriptor.peerId,
          endpoint: baseUrl,
        },
      };
    } catch (error) {
      return { ok: false, failure: classifyPairError(error) };
    }
  }

  /** Step 2: spend the token and store the peer. */
  async confirmPairing(url: string, force = false): Promise<PairConfirmResult> {
    try {
      const result = await beamPair(url, this.peers, {
        identity: this.identity,
        endpoints: this.advertisedEndpoints(),
        force,
      });
      this.prober.sync();
      this.notify();
      const machine = this.listMachines().find(
        (m) => m.peerId === result.peer.peerId
      );
      if (!machine) throw new Error('paired peer vanished immediately');
      return { ok: true, machine };
    } catch (error) {
      return { ok: false, failure: classifyPairError(error) };
    }
  }

  renameMachine(peerId: string, label: string): MachineView {
    if (peerId === this.identity.peerId) {
      this.identity = renameIdentity(this.beamDir, label);
    } else {
      this.peers.rename(peerId, label);
    }
    this.notify();
    return this.requireMachine(peerId);
  }

  revokeMachine(peerId: string): MachineView {
    this.peers.revoke(peerId);
    this.connections.get(peerId)?.close();
    this.prober.sync();
    this.notify();
    return this.requireMachine(peerId);
  }

  forgetMachine(peerId: string): void {
    this.connections.get(peerId)?.close();
    this.peers.remove(peerId);
    this.prober.forget(peerId);
    this.prober.sync();
    this.notify();
  }

  private requireMachine(peerId: string): MachineView {
    const machine = this.listMachines().find((m) => m.peerId === peerId);
    if (!machine) throw new Error(`unknown machine: ${peerId}`);
    return machine;
  }

  /** Dial `hostPeerId` at `endpoint` for a live, mutually-authenticated
   *  connection — used by later phases to open streams. Exposed here so
   *  a caller can force a connection (rather than waiting on a probe)
   *  without duplicating the auth handshake. */
  async connectTo(endpoint: string, hostPeerId: string): Promise<void> {
    await beamDial(endpoint, hostPeerId, {
      identity: this.identity,
      peers: this.peers,
      registry: this.registry,
      connections: this.connections,
    });
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.prober.stop();
    this.mailbox.dispose();
    this.remote.dispose();
    this.mail.dispose();
    if (this.host) {
      await this.host.close();
      this.host = null;
    } else {
      for (const connection of this.connections.list()) connection.close();
    }
    this.listeners.clear();
  }
}
