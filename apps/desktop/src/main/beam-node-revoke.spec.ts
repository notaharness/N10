/**
 * Revoking and forgetting a machine, against a peer that will not
 * cooperate in its own removal.
 *
 * docs/beam.md: every revocation path terminates the connection rather
 * than closing it gracefully, because a graceful close is a request and
 * the peer that has just lost access is the one with a reason to decline
 * it — `ws` then holds the socket open for its 30s close timeout,
 * delivering that peer's frames the whole time. A cooperative peer
 * cannot tell the two apart, which is why the peer here is a raw socket
 * that answers nothing.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { connect, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ConnectionRegistry,
  dial,
  loadOrCreateIdentity,
  pair,
  PeerTable,
  type Transport,
  type TransportSocket,
} from '@n10/beam';
import { BeamNode } from './beam-node.js';

let dirNode: string;
let dirPeer: string;
let node: BeamNode;
const sockets: Socket[] = [];

beforeEach(() => {
  dirNode = mkdtempSync(join(tmpdir(), 'beam-revoke-node-'));
  dirPeer = mkdtempSync(join(tmpdir(), 'beam-revoke-peer-'));
  node = new BeamNode({
    beamDir: dirNode,
    hostname: () => 'workbox',
    probeIntervalMs: 10_000,
    // Deliberately fast, and deliberately answered (see
    // `stubbornTransport`). A revoke has to be what drops this peer,
    // and the way to know that is to have the liveness monitor running
    // hard the whole time and watch it not drop anything.
    liveness: { intervalMs: 100, timeoutMs: 300 },
  });
});

afterEach(async () => {
  for (const socket of sockets.splice(0, sockets.length)) socket.destroy();
  await node.dispose();
  rmSync(dirNode, { recursive: true, force: true });
  rmSync(dirPeer, { recursive: true, force: true });
});

async function waitFor(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** A client-to-server pong frame: FIN + opcode 0xA, zero-length, and
 *  masked as every frame from a client must be. Four zero bytes are a
 *  valid mask, and masking nothing with it is still nothing. */
const MASKED_PONG = Buffer.from([0x8a, 0x80, 0, 0, 0, 0]);
/** FIN + opcode 0x9. The only thing the host sends this peer, since no
 *  stream is ever opened on the connection. */
const PING_OPCODE = 0x89;

/**
 * A transport whose `close()` does nothing at all: the peer end of a
 * WebSocket that has been asked to go away and has decided not to. The
 * socket is raw, so nothing underneath answers the close handshake
 * either — only the machine at the far end destroying the transport
 * ends this connection.
 *
 * It does answer pings, though, hand-rolled on the raw socket. Without
 * that, the only reason this peer outlives the 1.5s race below is that
 * the host's pong bound is longer than 1.5s, and the tests would start
 * passing for the wrong reason the day that bound was shortened —
 * reading "revocation dropped it" off a timer that dropped it anyway.
 */
function stubbornTransport(): { transport: Transport; closed: Promise<void> } {
  let resolveClosed: () => void = () => undefined;
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });
  const transport: Transport = {
    connect: (url) =>
      new Promise<TransportSocket>((resolve, reject) => {
        const target = new URL(url);
        const socket = connect(Number(target.port), target.hostname);
        sockets.push(socket);
        const closeHandlers: (() => void)[] = [];
        socket.on('error', () => undefined);
        socket.on('close', () => {
          resolveClosed();
          for (const handler of closeHandlers) handler();
        });
        socket.on('connect', () => {
          socket.write(
            `GET ${target.pathname}${target.search} HTTP/1.1\r\n` +
              `Host: ${target.host}\r\n` +
              'Upgrade: websocket\r\n' +
              'Connection: Upgrade\r\n' +
              'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n' +
              'Sec-WebSocket-Version: 13\r\n\r\n'
          );
        });
        socket.once('data', (chunk: Buffer) => {
          const status = chunk.toString('latin1').split('\r\n')[0];
          if (!status.includes('101')) {
            reject(new Error(`upgrade refused: ${status}`));
            return;
          }
          // Past the handshake every byte from the host is a ping:
          // nothing here opens a stream, so there is no other frame it
          // could be.
          socket.on('data', (frame: Buffer) => {
            if (frame[0] === PING_OPCODE) socket.write(MASKED_PONG);
          });
          resolve({
            send: () => undefined,
            // Everything after the 101 is ignored, the close frame
            // included.
            close: () => undefined,
            terminate: () => socket.destroy(),
            onData: () => undefined,
            onClose: (handler) => closeHandlers.push(handler),
          });
        });
      }),
  };
  return { transport, closed };
}

async function attachStubbornPeer(): Promise<{
  peerId: string;
  closed: Promise<void>;
}> {
  const status = await node.startAccepting();
  const identity = loadOrCreateIdentity(dirPeer, { hostname: () => 'laptop' });
  const peers = new PeerTable(dirPeer);
  const { baseUrl, peer } = await pair(status.pairingUrl!, peers, { identity });
  const { transport, closed } = stubbornTransport();
  await dial(baseUrl, peer.peerId, {
    identity,
    peers,
    transport,
    connections: new ConnectionRegistry(),
  });
  await waitFor(
    () =>
      node.listMachines().find((m) => m.peerId === identity.peerId)?.state ===
      'connected'
  );
  return { peerId: identity.peerId, closed };
}

function dropped(closed: Promise<void>): Promise<string> {
  return Promise.race([
    closed.then(() => 'dropped'),
    new Promise<string>((resolve) =>
      setTimeout(() => resolve('still up'), 1500)
    ),
  ]);
}

describe('revoking a machine that will not close', () => {
  it('leaves a peer that has not been revoked alone, however uncooperative', async () => {
    // The control the two assertions below need: a peer that answers
    // the transport's own question keeps its connection across many
    // ping intervals, so "revocation dropped it" is a statement about
    // revocation rather than about a timer.
    const peer = await attachStubbornPeer();

    expect(await dropped(peer.closed)).toBe('still up');
    expect(
      node.listMachines().find((m) => m.peerId === peer.peerId)?.state
    ).toBe('connected');
  });

  it('drops its connection instead of asking it to leave', async () => {
    const peer = await attachStubbornPeer();

    const machine = node.revokeMachine(peer.peerId);

    expect(machine.state).toBe('revoked');
    expect(await dropped(peer.closed)).toBe('dropped');
  });

  it('forgetting one drops it too', async () => {
    const peer = await attachStubbornPeer();

    node.forgetMachine(peer.peerId);

    expect(node.listMachines().some((m) => m.peerId === peer.peerId)).toBe(
      false
    );
    expect(await dropped(peer.closed)).toBe('dropped');
  });
});
