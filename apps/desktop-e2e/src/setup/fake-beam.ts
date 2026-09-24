import { mkdirSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { dirname, join } from 'node:path';

/**
 * A scripted beam daemon on the control socket the app finds in the
 * fixture HOME (`$XDG_CONFIG_HOME/beam/run/beam.sock`, beam docs/06):
 * newline-delimited JSON requests and events, enough of each op to drive
 * the machines UI. It never dials a peer or runs a ceremony; a test
 * walks one with `nextPasskeyStep`, `stage`, `failCeremony` and
 * `finishCeremony`. The real daemon is exercised by the beam e2e suite.
 */

export interface FakePeer {
  peerId: string;
  label: string;
  alias?: string | null;
  state?: 'connected' | 'offline' | 'revoked';
  grant?: 'all' | 'msg' | 'none';
}

export interface FakeBeamScenario {
  enrolled: boolean;
  peers?: FakePeer[];
}

/** A member for scenarios that need one. */
export const WORKBOX = 'c0ffee00c0ffee00c0ffee00c0ffee00';

export const SELF_PEER_ID = 'a1b2c3d4e5f60718a1b2c3d4e5f60718';
export const FLEET_ID = '3f9a0c4e7d12e805'.padEnd(64, '0');

type Request = Record<string, unknown> & { id: number; op: string };

/** A ceremony URL shaped as beam writes one (docs/02): `o` the
 *  operation, `l` and `f` the machine and its fingerprint, `n` the
 *  fleet for a create; `s` differs per request. */
function ceremonyUrl(
  o: 'c' | 'a' | 'r',
  fields: { l: string; f: string; n?: string; s: string }
): string {
  const fragment = new URLSearchParams({ o, s: fields.s, k: 'k', c: 'c' });
  fragment.set('l', fields.l);
  fragment.set('f', fields.f.slice(0, 16));
  if (fields.n !== undefined) fragment.set('n', fields.n);
  return `https://beam.n10.is/#${fragment.toString()}`;
}

export class FakeBeam {
  readonly requests: Request[] = [];
  private readonly subscribers = new Set<Socket>();
  private readonly sockets = new Set<Socket>();
  private enrolled: boolean;
  private readonly peers: Map<string, Required<FakePeer>>;
  private waiting: {
    start: Request;
    socket: Socket;
    id: number;
  } | null = null;
  private slots = 0;

  private constructor(
    private readonly server: Server,
    scenario: FakeBeamScenario
  ) {
    this.enrolled = scenario.enrolled;
    this.peers = new Map(
      (scenario.peers ?? []).map((p) => [
        p.peerId,
        { alias: null, state: 'connected', grant: 'all', ...p },
      ])
    );
  }

  static async start(
    homeDir: string,
    scenario: FakeBeamScenario
  ): Promise<FakeBeam> {
    const socketPath = join(homeDir, '.config', 'beam', 'run', 'beam.sock');
    mkdirSync(dirname(socketPath), { recursive: true });
    const server = createServer();
    const beam = new FakeBeam(server, scenario);
    server.on('connection', (socket) => beam.accept(socket));
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));
    return beam;
  }

  ops(op: string): Request[] {
    return this.requests.filter((r) => r.op === op);
  }

  private readonly refusals = new Map<
    string,
    { code: string; detail: string }
  >();

  /** Answers every later `op` with beam's error. */
  refuse(op: string, code: string, detail = ''): void {
    this.refusals.set(op, { code, detail });
  }

  /** The URL the latest `*.start` answered, or step 2's once sent. */
  currentUrl = '';

  /** `init`'s second passkey step: the `ceremony` event its wait hears. */
  nextPasskeyStep(): string {
    const w = this.requireWaiting();
    this.currentUrl = this.urlFor('a', w.start);
    this.send(w.socket, {
      event: 'ceremony',
      data: { ceremonyUrl: this.currentUrl },
    });
    return this.currentUrl;
  }

  /** A `stage` event to the waiting client. */
  stage(stage: string): void {
    const w = this.requireWaiting();
    this.send(w.socket, { event: 'stage', data: { stage } });
  }

  /** Ends the `*.wait` under way with beam's error. */
  failCeremony(code: string, detail = ''): void {
    const w = this.requireWaiting();
    this.waiting = null;
    this.fail(w.socket, w.id, code, detail);
  }

  /** Answers the `*.wait` under way as the daemon would once the owner's
   *  passkey is done. */
  finishCeremony(published: true | 'pending' = true): void {
    const w = this.requireWaiting();
    this.waiting = null;
    let result: Record<string, unknown>;
    if (w.start.op === 'revoke.start') {
      const peer = this.peers.get(String(w.start.peer));
      if (peer) {
        peer.state = 'revoked';
        this.emit('peer', this.view(peer));
      }
      result = { local: true, published, acknowledgedBy: 0 };
    } else {
      this.enrolled = true;
      result = {
        peerId: SELF_PEER_ID,
        fleetId: FLEET_ID,
        members: this.peers.size,
        published,
      };
    }
    this.reply(w.socket, w.id, result);
  }

  private requireWaiting(): NonNullable<FakeBeam['waiting']> {
    if (!this.waiting) throw new Error('no ceremony is waiting');
    return this.waiting;
  }

  private urlFor(o: 'c' | 'a' | 'r', start: Request): string {
    this.slots += 1;
    const s = `slot${this.slots}`;
    if (o === 'r') {
      const peer = this.peers.get(String(start.peer));
      return ceremonyUrl('r', {
        l: peer?.label ?? '',
        f: String(start.peer),
        s,
      });
    }
    const l = String(start.label || 'laptop');
    const n = o === 'c' ? String(start.fleetName || 'beam') : undefined;
    return ceremonyUrl(o, { l, f: SELF_PEER_ID, n, s });
  }

  async close(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  private accept(socket: Socket): void {
    this.sockets.add(socket);
    socket.on('error', () => undefined);
    socket.on('close', () => {
      this.sockets.delete(socket);
      this.subscribers.delete(socket);
    });
    let buffered = '';
    socket.on('data', (chunk: Buffer) => {
      buffered += chunk.toString('utf8');
      let newline = buffered.indexOf('\n');
      while (newline !== -1) {
        this.handle(socket, JSON.parse(buffered.slice(0, newline)) as Request);
        buffered = buffered.slice(newline + 1);
        newline = buffered.indexOf('\n');
      }
    });
  }

  private view(p: Required<FakePeer>) {
    return {
      peerId: p.peerId,
      label: p.label,
      alias: p.alias,
      state: p.state,
      inbound: true,
      path: 'direct',
      lastSeenAt: Date.now(),
      grant: p.grant,
      revokedAt: p.state === 'revoked' ? Date.now() : null,
      pinnedAt: 1,
      queue: { outbound: 0, inbound: 0, refused: 0 },
    };
  }

  private send(socket: Socket, value: unknown): void {
    socket.write(`${JSON.stringify(value)}\n`);
  }

  private fail(socket: Socket, id: number, code: string, detail: string): void {
    this.send(socket, { id, ok: false, error: code, detail });
  }

  private reply(socket: Socket, id: number, result: unknown): void {
    this.send(socket, { id, ok: true, result });
  }

  private emit(event: string, data: unknown): void {
    for (const s of this.subscribers) this.send(s, { event, data });
  }

  private handle(socket: Socket, req: Request): void {
    this.requests.push(req);
    const refusal = this.refusals.get(req.op);
    if (refusal) return this.fail(socket, req.id, refusal.code, refusal.detail);
    const answer = this.answer(socket, req);
    if (answer !== undefined) this.reply(socket, req.id, answer);
  }

  /** The op's result, or `undefined` for a `*.wait` answered later. */
  private answer(socket: Socket, req: Request): unknown {
    const [subject, verb] = req.op.split('.');
    if (verb === 'start') return this.start(req, subject);
    if (verb === 'wait') return this.wait(socket, req);
    if (req.op === 'ceremony.cancel') {
      if (this.waiting) this.failCeremony('ceremony-cancelled');
      return {};
    }
    switch (req.op) {
      case 'status':
        return this.enrolled
          ? {
              ready: true,
              enrolled: true,
              peerId: SELF_PEER_ID,
              label: 'laptop',
              fleetId: FLEET_ID,
            }
          : { ready: true, enrolled: false };
      case 'fleet.reset':
        this.enrolled = false;
        this.peers.clear();
        return {};
      case 'events.subscribe':
        this.subscribers.add(socket);
        return {};
      case 'peers':
        return { peers: [...this.peers.values()].map((p) => this.view(p)) };
      case 'peer.alias':
      case 'peer.grant':
        return this.updatePeer(req);
      default:
        return {};
    }
  }

  private updatePeer(req: Request): unknown {
    const peer = this.peers.get(String(req.peer));
    if (!peer) return {};
    if (req.op === 'peer.alias')
      peer.alias = (req.alias as string | null) ?? null;
    else peer.grant = req.grant as Required<FakePeer>['grant'];
    this.emit('peer', this.view(peer));
    return {};
  }

  private start(req: Request, subject: string): unknown {
    const o = subject === 'init' ? 'c' : subject === 'join' ? 'a' : 'r';
    this.currentUrl = this.urlFor(o, req);
    return { ceremonyUrl: this.currentUrl };
  }

  private wait(socket: Socket, req: Request): undefined {
    const op = req.op.split('.')[0];
    const start = [...this.requests]
      .reverse()
      .find((r) => r.op === `${op}.start`);
    if (!start) throw new Error(`${req.op} without its start`);
    this.waiting = { start, socket, id: req.id };
    return undefined;
  }
}
