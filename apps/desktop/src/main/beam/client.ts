import type { BeamStatus, MachineView } from '../../host/contract-machines.js';
import { setInboundMailPort } from '../../host/services/inbound-mail.js';
import {
  getLastKnownMachines,
  receiveBeamStatus,
  receiveMachinesUpdate,
  refreshMailOverlay,
  setMachinesPort,
  type MachinesPort,
} from '../../host/services/machines.js';
import { setRemoteMachinePort } from '../../host/services/remote-machines.js';
import { runCeremony } from './ceremony.js';
import type { ControlConnection } from './control.js';
import { DaemonLauncher } from './launcher.js';
import { MailRelay } from './mail-relay.js';
import type { OwnedDaemon } from './owned-daemon.js';
import {
  localMachine,
  machineFromPeer,
  mergePeer,
  orderMachines,
  type DaemonStatus,
  type PeerView,
} from './peers.js';
import { createRemoteMachinePort } from './remote.js';

/** beam docs/08: an unexpected loss reconnects from 500 ms to 30 s. */
const MIN_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 30_000;

export interface BeamClientOptions {
  socketPath: string;
  /** Starts a daemon when none answers; without it the client only
   *  connects to one already running. */
  spawnDaemon?: () => OwnedDaemon;
  log?: (message: string) => void;
}

/**
 * n10 Desktop's client of the beam daemon's control socket (beam
 * docs/06, docs/08). It installs the machines, remote-machine and
 * inbound-mail ports over one control connection that also carries the
 * daemon's events, plus a connection for the mail relay and one per
 * ceremony, and keeps them connected with backoff.
 */
export class BeamClient {
  /** Set only once subscribed to events, so no list misses one. */
  private main: ControlConnection | null = null;
  private readonly relay: MailRelay;
  private readonly launcher: DaemonLauncher;
  /** The enrolment (`fleetId/peerId`) the relay is subscribed under. */
  private relayFor: string | null = null;
  /** Peer events heard while each list in flight is read. */
  private readonly listings = new Set<PeerView[]>();
  private ceremony: AbortController | null = null;
  private everConnected = false;
  private stopped = false;
  private backoff = MIN_BACKOFF_MS;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private status: BeamStatus = {
    state: 'connecting',
    detail: null,
    enrolled: false,
  };

  constructor(private readonly options: BeamClientOptions) {
    this.launcher = new DaemonLauncher(options.socketPath, options.spawnDaemon);
    this.relay = new MailRelay({
      socketPath: options.socketPath,
      onChange: refreshMailOverlay,
      log: options.log,
    });
  }

  start(): void {
    setMachinesPort(this.machinesPort());
    setRemoteMachinePort(
      createRemoteMachinePort({
        request: (op, fields) => this.requireMain().request(op, fields),
        socketPath: this.options.socketPath,
      })
    );
    setInboundMailPort(this.relay);
    this.publish(this.status);
    this.connectNow();
  }

  /** Disconnects, and stops the daemon if this client started it. The
   *  loss of the connection that follows is deliberate: nothing
   *  reconnects or respawns. */
  async shutdown(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.stopRelay();
    const conn = this.main;
    this.main = null;
    conn?.close();
    await this.launcher.stop();
  }

  private requireMain(): ControlConnection {
    if (!this.main) throw new Error('beam is not connected');
    return this.main;
  }

  private log(what: string, err: unknown): void {
    this.options.log?.(`[beam] ${what}: ${String(err)}`);
  }

  private publish(status: BeamStatus): void {
    this.status = status;
    receiveBeamStatus(status);
  }

  private connectNow(): void {
    this.timer = null;
    this.connect().catch((err: unknown) => this.log('connecting', err));
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    let conn: ControlConnection;
    try {
      conn = await this.launcher.connect();
    } catch (err) {
      this.unreachable(err);
      return;
    }
    if (this.stopped) {
      conn.close();
      return;
    }
    conn.onClose(() => this.lost(conn));
    conn.onEvent((event, data) => this.onEvent(event, data));
    try {
      await conn.request('events.subscribe');
    } catch (err) {
      this.log('subscribing to events', err);
      conn.close();
      this.retryLater();
      return;
    }
    this.main = conn;
    this.everConnected = true;
    this.backoff = MIN_BACKOFF_MS;
    try {
      receiveMachinesUpdate(await this.list());
    } catch (err) {
      this.log('listing machines', err);
      conn.close();
    }
  }

  private unreachable(err: unknown): void {
    const why = err instanceof Error ? err.message : String(err);
    this.publish({
      ...this.status,
      state: this.everConnected ? 'restarting' : 'unavailable',
      detail: this.everConnected ? null : why,
    });
    this.retryLater();
  }

  private lost(conn: ControlConnection): void {
    if (this.main !== conn) return;
    this.main = null;
    this.stopRelay();
    if (this.stopped) return;
    this.publish({ ...this.status, state: 'restarting', detail: null });
    this.retryLater();
  }

  private retryLater(): void {
    if (this.stopped || this.timer) return;
    this.timer = setTimeout(() => this.connectNow(), this.backoff);
    this.timer.unref?.();
    this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
  }

  private onEvent(event: string, data: unknown): void {
    if (event !== 'peer' && event !== 'peer.new') return;
    const peer = data as PeerView;
    for (const heard of this.listings) heard.push(peer);
    // The daemon announces no enrolment, so a peer heard while this
    // machine looked unenrolled means one happened elsewhere (the CLI).
    if (!this.status.enrolled) this.refresh();
    else receiveMachinesUpdate(mergePeer(getLastKnownMachines(), peer));
  }

  /** Re-reads the list after a change no event announces (enrolment). */
  private refresh(): void {
    this.list().then(receiveMachinesUpdate, (err: unknown) =>
      this.log('listing machines', err)
    );
  }

  /** Reads `status` and every page of `peers`, `[]` until enrolled, and
   *  applies over it any peer event that overtook the reply. */
  private async list(): Promise<MachineView[]> {
    const conn = this.requireMain();
    const heard: PeerView[] = [];
    this.listings.add(heard);
    try {
      const status = await conn.request<DaemonStatus>('status');
      this.publish({ state: 'ready', detail: null, enrolled: status.enrolled });
      this.syncRelay(status);
      if (!status.enrolled) return [];
      const peers: PeerView[] = [];
      let cursor: string | undefined;
      do {
        const page = await conn.request<{ peers: PeerView[]; next?: string }>(
          'peers',
          cursor ? { cursor } : {}
        );
        peers.push(...page.peers);
        cursor = page.next;
      } while (cursor);
      return heard.reduce(
        mergePeer,
        orderMachines([localMachine(status), ...peers.map(machineFromPeer)])
      );
    } finally {
      this.listings.delete(heard);
    }
  }

  /** The relay is subscribed under the daemon's current enrolment:
   *  `msg.subscribe` is `not-enrolled` before one, and a subscription
   *  outlives a `beam fleet reset` in the daemon, so a new enrolment
   *  needs a new one. */
  private syncRelay(status: DaemonStatus): void {
    const enrolment = status.enrolled
      ? `${status.fleetId}/${status.peerId}`
      : null;
    if (enrolment === this.relayFor || this.stopped) return;
    this.stopRelay();
    if (enrolment) this.startRelay(enrolment);
  }

  private startRelay(enrolment: string): void {
    this.relayFor = enrolment;
    this.relay
      .start(() => {
        // Its connection dropped while the main one may live on.
        this.relayFor = null;
        if (this.main) setTimeout(() => this.refresh(), MIN_BACKOFF_MS);
      })
      .catch((err: unknown) => {
        if (this.relayFor === enrolment) this.relayFor = null;
        this.log('mail relay', err);
      });
  }

  private stopRelay(): void {
    this.relay.stop();
    this.relayFor = null;
  }

  private machinesPort(): MachinesPort {
    return {
      listMachines: () => this.list(),
      setAlias: async (peerId, alias) => {
        await this.requireMain().request('peer.alias', { peer: peerId, alias });
      },
      setGrant: async (peerId, grant) => {
        await this.requireMain().request('peer.grant', { peer: peerId, grant });
      },
      runCeremony: async (request, onProgress) => {
        const abort = new AbortController();
        this.ceremony = abort;
        try {
          const outcome = await runCeremony(
            this.options.socketPath,
            request,
            onProgress,
            abort.signal
          );
          // A failure too: the daemon may have committed before it failed.
          if (this.main) this.refresh();
          return outcome;
        } finally {
          if (this.ceremony === abort) this.ceremony = null;
        }
      },
      // Only this app's own ceremony: `ceremony.cancel` ends whichever
      // one the daemon runs, and that may be the CLI's.
      cancelCeremony: async () => {
        this.ceremony?.abort();
      },
    };
  }
}
