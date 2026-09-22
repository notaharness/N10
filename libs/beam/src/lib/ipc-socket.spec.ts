import { EventEmitter } from 'node:events';
import { createConnection, createServer, type Socket } from 'node:net';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectionRegistry } from './connection-registry.js';
import { createConnection as createBeamConnection } from './connection.js';
import { loadOrCreateIdentity, type Identity } from './identity.js';
import { IpcSocket } from './ipc-socket.js';
import { InboundStore } from './mailbox/inbound-store.js';
import { Mailbox } from './mailbox/mailbox.js';
import { PeerTable } from './peer-table.js';
import { StreamRegistry } from './stream-registry.js';
import type { TransportSocket } from './transport.js';

async function waitFor<T>(
  read: () => T,
  predicate: (value: T) => boolean,
  timeoutMs = 3000
): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = read();
    if (predicate(value)) return value;
    if (Date.now() - started > timeoutMs) {
      throw new Error('timed out waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

let dirs: string[] = [];
let sockets: IpcSocket[] = [];

beforeEach(() => {
  dirs = [];
  sockets = [];
});

afterEach(async () => {
  for (const s of sockets) await s.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

interface TestNode {
  dir: string;
  identity: Identity;
  peers: PeerTable;
  registry: StreamRegistry;
  connections: ConnectionRegistry;
  mailbox: Mailbox;
}

function makeNode(hostname: string): TestNode {
  const dir = tmp(`beam-ipc-${hostname}-`);
  const identity = loadOrCreateIdentity(dir, { hostname: () => hostname });
  const peers = new PeerTable(dir);
  const registry = new StreamRegistry();
  const connections = new ConnectionRegistry();
  const mailbox = new Mailbox({
    identity,
    peers,
    connections,
    registry,
    beamDir: dir,
    ackTimeoutMs: 200,
    retryIntervalMs: 30,
    sendAwaitMs: 300,
  });
  return { dir, identity, peers, registry, connections, mailbox };
}

function wireSockets(): [TransportSocket, TransportSocket] {
  const aHandlers: ((data: Uint8Array) => void)[] = [];
  const bHandlers: ((data: Uint8Array) => void)[] = [];
  const aCloseHandlers: (() => void)[] = [];
  const bCloseHandlers: (() => void)[] = [];
  const a: TransportSocket = {
    send: (data) => bHandlers.forEach((h) => h(data)),
    close: () => aCloseHandlers.forEach((h) => h()),
    terminate: () => aCloseHandlers.forEach((h) => h()),
    onData: (h) => aHandlers.push(h),
    onClose: (h) => aCloseHandlers.push(h),
  };
  const b: TransportSocket = {
    send: (data) => aHandlers.forEach((h) => h(data)),
    close: () => bCloseHandlers.forEach((h) => h()),
    terminate: () => bCloseHandlers.forEach((h) => h()),
    onData: (h) => bHandlers.push(h),
    onClose: (h) => bCloseHandlers.push(h),
  };
  return [a, b];
}

function connectNodes(dialer: TestNode, acceptor: TestNode): void {
  const [a, b] = wireSockets();
  dialer.connections.add(
    createBeamConnection({
      peerId: acceptor.identity.peerId,
      label: 'acceptor',
      role: 'initiator',
      socket: a,
      registry: dialer.registry,
    })
  );
  acceptor.connections.add(
    createBeamConnection({
      peerId: dialer.identity.peerId,
      label: 'dialer',
      role: 'acceptor',
      socket: b,
      registry: acceptor.registry,
    })
  );
}

function pairNodes(a: TestNode, b: TestNode): void {
  a.peers.upsert({
    peerId: b.identity.peerId,
    label: 'b',
    publicKeyPem: b.identity.publicKeyPem,
    endpoints: [],
  });
  b.peers.upsert({
    peerId: a.identity.peerId,
    label: 'a',
    publicKeyPem: a.identity.publicKeyPem,
    endpoints: [],
  });
}

async function startIpc(
  node: TestNode
): Promise<{ socket: IpcSocket; path: string }> {
  const path = join(node.dir, 'run', 'inbox.sock');
  const socket = new IpcSocket({
    path,
    mailbox: node.mailbox,
    peers: node.peers,
    connections: node.connections,
  });
  await socket.listen();
  sockets.push(socket);
  return { socket, path };
}

/** A raw client for the line-delimited JSON protocol. */
function connectClient(path: string): {
  conn: Socket;
  send: (message: Record<string, unknown>) => void;
  nextLine: () => Promise<Record<string, unknown>>;
} {
  const conn = createConnection(path);
  const lines: Record<string, unknown>[] = [];
  const waiters: ((line: Record<string, unknown>) => void)[] = [];
  let buffer = '';
  conn.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
    let at: number;
    while ((at = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, at);
      buffer = buffer.slice(at + 1);
      if (!line.trim()) continue;
      const parsed = JSON.parse(line) as Record<string, unknown>;
      const waiter = waiters.shift();
      if (waiter) waiter(parsed);
      else lines.push(parsed);
    }
  });
  return {
    conn,
    send: (message) => conn.write(`${JSON.stringify(message)}\n`),
    nextLine: () =>
      new Promise((resolve) => {
        const already = lines.shift();
        if (already) {
          resolve(already);
          return;
        }
        waiters.push(resolve);
      }),
  };
}

async function waitForOpen(conn: Socket): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    conn.once('connect', resolve);
    conn.once('error', reject);
  });
}

describe('IpcSocket', () => {
  it('send over the socket produces the same outcome shape as the library call', async () => {
    const a = makeNode('a');
    const b = makeNode('b');
    pairNodes(a, b);
    const { path } = await startIpc(a);

    const client = connectClient(path);
    await waitForOpen(client.conn);
    client.send({
      op: 'send',
      to: b.identity.peerId,
      topic: 'orchestra',
      payload: 'hi',
    });
    const response = await client.nextLine();

    expect(response['status']).toBe('queued'); // no connection to b
    expect(response['to']).toBe(b.identity.peerId);
    expect(response['label']).toBe('b');
    expect(typeof response['queueDepth']).toBe('number');
    client.conn.destroy();
  });

  it('subscribe receives an envelope and acknowledges it', async () => {
    const a = makeNode('a');
    const b = makeNode('b');
    pairNodes(a, b);
    connectNodes(a, b);
    const { path } = await startIpc(b);

    const client = connectClient(path);
    await waitForOpen(client.conn);
    client.send({ op: 'subscribe', topic: 'orchestra' });

    await a.mailbox.send({
      to: b.identity.peerId,
      topic: 'orchestra',
      payload: 'over-ipc',
    });
    const envelope = await client.nextLine();
    expect(envelope['payload']).toBe('over-ipc');
    client.send({ op: 'ack', id: envelope['id'] });
    client.conn.destroy();
  });

  it('a consumer that drops mid-message leaves the envelope unacknowledged, redelivered to the next consumer', async () => {
    const a = makeNode('a');
    const b = makeNode('b');
    pairNodes(a, b);
    connectNodes(a, b);
    const { path } = await startIpc(b);

    const first = connectClient(path);
    await waitForOpen(first.conn);
    first.send({ op: 'subscribe', topic: 'orchestra' });

    const second = connectClient(path);
    await waitForOpen(second.conn);
    second.send({ op: 'subscribe', topic: 'orchestra' });

    await a.mailbox.send({
      to: b.identity.peerId,
      topic: 'orchestra',
      payload: 'redeliver-me',
    });
    const seenByFirst = await first.nextLine();
    expect(seenByFirst['payload']).toBe('redeliver-me');

    // The first consumer vanishes without acking.
    first.conn.destroy();

    const seenBySecond = await second.nextLine();
    expect(seenBySecond['payload']).toBe('redeliver-me');
    expect(seenBySecond['id']).toBe(seenByFirst['id']);
    second.send({ op: 'ack', id: seenBySecond['id'] });
    second.conn.destroy();
  });

  it('status over the socket reports peers', async () => {
    const a = makeNode('a');
    const b = makeNode('b');
    pairNodes(a, b);
    const { path } = await startIpc(a);
    const client = connectClient(path);
    await waitForOpen(client.conn);
    client.send({ op: 'status' });
    const response = await client.nextLine();
    const peers = response['peers'] as { peerId: string }[];
    expect(peers.some((p) => p.peerId === b.identity.peerId)).toBe(true);
    client.conn.destroy();
  });

  it('a stale socket file (nothing listening) is replaced', async () => {
    const dir = tmp('beam-ipc-stale-');
    const path = join(dir, 'run');
    const sockPath = join(path, 'inbox.sock');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(path, { recursive: true });

    // Leave a socket file behind with nothing listening on it.
    const leaked = createServer();
    await new Promise<void>((resolve) => leaked.listen(sockPath, resolve));
    await new Promise<void>((resolve) => leaked.close(() => resolve()));

    const identity = loadOrCreateIdentity(dir, { hostname: () => 'stale' });
    const peers = new PeerTable(dir);
    const connections = new ConnectionRegistry();
    const mailbox = new Mailbox({
      identity,
      peers,
      connections,
      registry: new StreamRegistry(),
      beamDir: dir,
    });
    const socket = new IpcSocket({
      path: sockPath,
      mailbox,
      peers,
      connections,
    });
    await expect(socket.listen()).resolves.toBeUndefined();
    sockets.push(socket);
  });

  it('a live socket is not replaced — a second listen on the same path fails', async () => {
    const a = makeNode('a');
    const { path } = await startIpc(a);
    const second = new IpcSocket({
      path,
      mailbox: a.mailbox,
      peers: a.peers,
      connections: a.connections,
    });
    await expect(second.listen()).rejects.toThrow(/already listening/);
  });

  it('the socket file is created 0600, with no window at a looser default', async () => {
    const a = makeNode('a');
    const { path } = await startIpc(a);
    const mode = statSync(path).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('a failed bind leaves no leaked mailbox subscription (D5)', async () => {
    const a = makeNode('a');
    // A NUL byte in the filename does not exist as far as `existsSync` is
    // concerned (it never throws, and reports false for an invalid path),
    // so `removeStaleSocket`'s own pre-check passes clean; the *actual*
    // `server.listen()` bind call then fails for real (EINVAL). This is
    // what exercises the real ordering bug — a subscribe wired in before
    // that bind call resolves or rejects, not before some earlier check.
    const badPath = join(a.dir, 'run', `bad${String.fromCharCode(0)}name.sock`);
    const socket = new IpcSocket({
      path: badPath,
      mailbox: a.mailbox,
      peers: a.peers,
      connections: a.connections,
    });
    const subscribeSpy = vi.spyOn(a.mailbox, 'subscribeInbound');

    await expect(socket.listen()).rejects.toThrow();

    // If listen() subscribed before the bind resolved, this would have been
    // called even though the bind itself failed — a subscription with
    // nothing that will ever unsubscribe it.
    expect(subscribeSpy).not.toHaveBeenCalled();
  });

  it('an accepted connection that errors does not crash the node (D3 audit)', async () => {
    const a = makeNode('a');
    const { socket } = await startIpc(a);
    const fake = new EventEmitter();
    Object.assign(fake, {
      write: () => true,
      writable: true,
      destroy: () => undefined,
    });

    const withPrivateAccess = socket as unknown as {
      handleConnection(s: Socket): void;
    };
    expect(() =>
      withPrivateAccess.handleConnection(fake as unknown as Socket)
    ).not.toThrow();
    // A local client resetting the connection must not crash the node — an
    // EventEmitter with nobody listening for 'error' throws synchronously
    // when one is emitted, which is exactly what happened before this fix.
    expect(() => fake.emit('error', new Error('ECONNRESET'))).not.toThrow();
  });

  it('a subscriber acking unlinks the mailbox inbound store, not just its own in-memory queue', async () => {
    const a = makeNode('a');
    const b = makeNode('b');
    pairNodes(a, b);
    connectNodes(a, b);
    const { path } = await startIpc(b);

    const client = connectClient(path);
    await waitForOpen(client.conn);
    client.send({ op: 'subscribe', topic: 'orchestra' });

    await a.mailbox.send({
      to: b.identity.peerId,
      topic: 'orchestra',
      payload: 'ack-unlinks',
    });
    const envelope = await client.nextLine();
    const before = new InboundStore(b.dir).list(a.identity.peerId);
    expect(before.map((e) => e.payload)).toEqual(['ack-unlinks']);

    client.send({ op: 'ack', id: envelope['id'] });
    await waitFor(
      () => new InboundStore(b.dir).list(a.identity.peerId).length,
      (n) => n === 0
    );
    client.conn.destroy();
  });

  describe('subscribe with a `from` filter (server-side peer filter)', () => {
    it('delivers a matching peer, and leaves a non-matching one for another subscriber rather than consuming it', async () => {
      const a = makeNode('a');
      const b = makeNode('b');
      const c = makeNode('c');
      pairNodes(a, b);
      pairNodes(c, b);
      connectNodes(a, b);
      connectNodes(c, b);
      const { path } = await startIpc(b);

      const filtered = connectClient(path);
      await waitForOpen(filtered.conn);
      filtered.send({ op: 'subscribe', from: [a.identity.peerId] });

      const catchAll = connectClient(path);
      await waitForOpen(catchAll.conn);
      catchAll.send({ op: 'subscribe' });

      // From c, which `filtered` does not want: must not go to `filtered`,
      // and must not be stuck behind it either — `catchAll` gets it.
      await c.mailbox.send({
        to: b.identity.peerId,
        topic: 't',
        payload: 'from-c',
      });
      const seenByCatchAll = await catchAll.nextLine();
      expect(seenByCatchAll['payload']).toBe('from-c');
      catchAll.send({ op: 'ack', id: seenByCatchAll['id'] });

      // From a, which `filtered` does want.
      await a.mailbox.send({
        to: b.identity.peerId,
        topic: 't',
        payload: 'from-a',
      });
      const seenByFiltered = await filtered.nextLine();
      expect(seenByFiltered['payload']).toBe('from-a');
      filtered.send({ op: 'ack', id: seenByFiltered['id'] });

      filtered.conn.destroy();
      catchAll.conn.destroy();
    });
  });

  describe('admin ops reach a running node immediately (D9/D15 review)', () => {
    it("revoke applies to the live PeerTable and drops the peer's live connection, without a restart", async () => {
      const a = makeNode('a');
      const b = makeNode('b');
      pairNodes(a, b);
      connectNodes(a, b);
      const { path } = await startIpc(a);

      expect(a.peers.get(b.identity.peerId)?.revoked).toBe(false);
      expect(a.connections.get(b.identity.peerId)).toBeDefined();

      const client = connectClient(path);
      await waitForOpen(client.conn);
      client.send({ op: 'revoke', peer: b.identity.peerId });
      const response = await client.nextLine();
      expect(response['status']).toBe('ok');

      // Applied to the live table this process already holds — no restart.
      expect(a.peers.get(b.identity.peerId)?.revoked).toBe(true);
      // And the persisted file agrees, for a process that does restart.
      expect(new PeerTable(a.dir).get(b.identity.peerId)?.revoked).toBe(true);
      // The live connection is dropped, not merely marked stale.
      expect(a.connections.get(b.identity.peerId)).toBeUndefined();

      client.conn.destroy();
    });

    it('rename and forget also apply to the live PeerTable immediately', async () => {
      const a = makeNode('a');
      const b = makeNode('b');
      pairNodes(a, b);
      const { path } = await startIpc(a);

      const client = connectClient(path);
      await waitForOpen(client.conn);

      client.send({
        op: 'rename',
        peer: b.identity.peerId,
        label: 'renamed-b',
      });
      const renameResponse = await client.nextLine();
      expect(renameResponse['status']).toBe('ok');
      expect(renameResponse['label']).toBe('renamed-b');
      expect(a.peers.get(b.identity.peerId)?.label).toBe('renamed-b');

      client.send({ op: 'forget', peer: b.identity.peerId });
      const forgetResponse = await client.nextLine();
      expect(forgetResponse['status']).toBe('ok');
      expect(a.peers.get(b.identity.peerId)).toBeUndefined();

      client.conn.destroy();
    });

    it('reload-peers picks up a pairing a separate process just wrote to peers.json', async () => {
      const a = makeNode('a');
      const { path } = await startIpc(a);

      // A separate PeerTable instance, as a second CLI process's `pair`
      // would construct, writes directly to the same beamDir.
      const outOfProcessWrite = new PeerTable(a.dir);
      outOfProcessWrite.upsert({
        peerId: '00000000000000fe',
        label: 'fresh',
        publicKeyPem: 'fresh-key',
        endpoints: [],
      });
      expect(a.peers.get('00000000000000fe')).toBeUndefined(); // not yet visible

      const client = connectClient(path);
      await waitForOpen(client.conn);
      client.send({ op: 'reload-peers' });
      const response = await client.nextLine();
      expect(response['status']).toBe('ok');

      expect(a.peers.get('00000000000000fe')?.label).toBe('fresh');
      client.conn.destroy();
    });

    it('reload-peers drops the connection of a peer revoked out of process', async () => {
      const a = makeNode('a');
      const b = makeNode('b');
      pairNodes(a, b);
      connectNodes(a, b);
      const { path } = await startIpc(a);
      expect(a.connections.get(b.identity.peerId)).toBeDefined();

      // A separate CLI invocation revokes by writing peers.json, which is
      // exactly the case reload-peers exists for.
      new PeerTable(a.dir).revoke(b.identity.peerId);

      const client = connectClient(path);
      await waitForOpen(client.conn);
      client.send({ op: 'reload-peers' });
      expect((await client.nextLine())['status']).toBe('ok');

      // A revocation that leaves the connection and its running shells up
      // is not a revocation.
      await waitFor(
        () => a.connections.get(b.identity.peerId),
        (connection) => connection === undefined
      );
      client.conn.destroy();
    });

    it('drops a client that sends an unterminated line past the cap', async () => {
      const a = makeNode('a');
      const { path } = await startIpc(a);
      const client = connectClient(path);
      await waitForOpen(client.conn);
      const closed = new Promise<void>((resolve) =>
        client.conn.once('close', () => resolve())
      );
      // No newline, ever: without a cap this buffer grows until the node
      // runs out of heap, and any local process can do it.
      client.conn.write('x'.repeat(2 * 1024 * 1024));
      await closed;
      expect(client.conn.destroyed).toBe(true);
    });

    it('an op that fails still answers, rather than leaving the caller hanging', async () => {
      const a = makeNode('a');
      const b = makeNode('b');
      pairNodes(a, b);
      const { path } = await startIpc(a);
      // `send` is async, so anything it throws arrives as a rejected
      // promise. A caller blocked on the response line — report.sh waiting
      // out a full disk — waits forever unless the failure is answered.
      vi.spyOn(a.mailbox, 'send').mockRejectedValue(
        new Error('the disk is on fire')
      );

      const client = connectClient(path);
      await waitForOpen(client.conn);
      client.send({ op: 'send', to: 'b', topic: 't', payload: 'hi' });
      const response = await client.nextLine();
      expect(response).toEqual({
        status: 'error',
        op: 'send',
        reason: 'the disk is on fire',
      });
      client.conn.destroy();
    });
  });
});

describe('IpcSocket: one silent subscriber must not stall the others', () => {
  interface Recorder {
    client: ReturnType<typeof connectClient>;
    lines: Record<string, unknown>[];
  }

  let recorders: Recorder[] = [];

  afterEach(() => {
    for (const r of recorders) r.client.conn.destroy();
    recorders = [];
  });

  /** A subscriber whose every delivered line is recorded as it arrives.
   * Assertions read the array rather than awaiting one line at a time:
   * "nothing arrived in this window" has to be answerable without leaving
   * an abandoned waiter behind to swallow the next real line. */
  async function subscriber(
    path: string,
    request: Record<string, unknown>
  ): Promise<Recorder> {
    const client = connectClient(path);
    await waitForOpen(client.conn);
    const lines: Record<string, unknown>[] = [];
    const recorder: Recorder = { client, lines };
    recorders.push(recorder);
    void (async () => {
      for (;;) {
        try {
          lines.push(await client.nextLine());
        } catch {
          return;
        }
      }
    })();
    client.send({ op: 'subscribe', ...request });
    // Let the subscribe land before any mail is sent, so the pump is
    // choosing between cursors rather than racing a subscription.
    await new Promise((resolve) => setTimeout(resolve, 50));
    return recorder;
  }

  function payloads(recorder: Recorder): unknown[] {
    return recorder.lines.map((line) => line['payload']);
  }

  it('a connected subscriber that never acks holds up only its own stream, not an unrelated topic', async () => {
    const a = makeNode('a');
    const b = makeNode('b');
    pairNodes(a, b);
    connectNodes(a, b);
    const { path } = await startIpc(b);

    const silent = await subscriber(path, { topic: 'wedged' });
    const healthy = await subscriber(path, { topic: 'orchestra' });

    const sendTo = (topic: string, payload: string): Promise<unknown> =>
      a.mailbox.send({ to: b.identity.peerId, topic, payload });

    // Wedge the first subscriber: it takes this one and never acks it.
    await sendTo('wedged', 'never-acked');
    await waitFor(
      () => payloads(silent),
      (seen) => seen.includes('never-acked')
    );

    // Two messages on an unrelated topic. The second can only arrive if
    // the first was acked and that subscriber's own cursor moved, so this
    // covers both "the wedge does not block another subscriber" and "each
    // subscriber's own stream is still sequential".
    for (const payload of ['first', 'second']) {
      await sendTo('orchestra', payload);
      const seen = await waitFor(
        () => healthy.lines,
        (lines) => lines.some((line) => line['payload'] === payload)
      );
      healthy.client.send({
        op: 'ack',
        id: seen.find((line) => line['payload'] === payload)?.['id'],
      });
    }
    expect(payloads(healthy)).toEqual(['first', 'second']);

    // The wedged subscriber really is stopped — without this, the
    // assertions above would also hold if `wedged` mail were simply never
    // routed anywhere.
    await sendTo('wedged', 'behind-the-wedge');
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(payloads(silent)).toEqual(['never-acked']);

    // Positive control for that negative: the moment it acks, the message
    // it was holding up arrives.
    silent.client.send({ op: 'ack', id: silent.lines[0]?.['id'] });
    await waitFor(
      () => payloads(silent),
      (seen) => seen.includes('behind-the-wedge')
    );
  });

  it('two catch-all subscribers are each handed an envelope at the same time, and neither waits on the other', async () => {
    const a = makeNode('a');
    const b = makeNode('b');
    pairNodes(a, b);
    connectNodes(a, b);
    const { path } = await startIpc(b);

    const one = await subscriber(path, {});
    const two = await subscriber(path, {});

    for (const payload of ['m1', 'm2']) {
      await a.mailbox.send({ to: b.identity.peerId, topic: 't', payload });
    }

    // Neither acks. With one shared in-flight slot the second envelope
    // waits behind the first forever; with a cursor each, both are out.
    await waitFor(
      () => [...payloads(one), ...payloads(two)].sort(),
      (seen) => seen.length === 2
    );
    // Each envelope goes to exactly one subscriber — the pump splices it
    // out of `pending` as it assigns it — never to both.
    expect([...payloads(one), ...payloads(two)].sort()).toEqual(['m1', 'm2']);
  });
});
