/**
 * End-to-end proof that a pairing grant is enforced, two nodes in one
 * process over a real loopback HTTP + WebSocket connection: A mints a
 * pairing URL granting only `msg`, B pairs and dials, and B's attempt to
 * open a `pty` on A is refused while its `msg` stream on the very same
 * connection still works.
 *
 * Every refusal here is checked against a positive control on the same
 * live connection. A test that only asserted "the pty stream failed" would
 * pass just as happily if the connection had died, which is the one way
 * this suite could prove nothing at all.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dial, pair } from './client.js';
import { createExecStreamHandler } from './exec-handler.js';
import { Host } from './host.js';
import { loadOrCreateIdentity, type Identity } from './identity.js';
import { StreamScopeError, type StreamScope } from './peer-scopes.js';
import { PeerTable } from './peer-table.js';
import { createPtyStreamHandler } from './pty-handler.js';
import type { PeerConnection } from './connection.js';
import type { BeamStream } from './stream.js';

let dirA: string;
let dirB: string;
let hostA: Host;
let identityA: Identity;
let identityB: Identity;
let peersA: PeerTable;
let peersB: PeerTable;
/** Every `msg` stream A accepted, so a positive control can show the
 * stream really reached A's handler rather than merely not erroring. */
let msgStreamsOnA: BeamStream[];
const openConnections: PeerConnection[] = [];

beforeEach(async () => {
  dirA = mkdtempSync(join(tmpdir(), 'beam-scope-a-'));
  dirB = mkdtempSync(join(tmpdir(), 'beam-scope-b-'));
  identityA = loadOrCreateIdentity(dirA, { hostname: () => 'workbox' });
  identityB = loadOrCreateIdentity(dirB, { hostname: () => 'laptop' });
  peersA = new PeerTable(dirA);
  peersB = new PeerTable(dirB);
  msgStreamsOnA = [];
  hostA = new Host({ identity: identityA, peers: peersA, port: 0 });
  hostA.registry.register('pty', createPtyStreamHandler());
  hostA.registry.register('exec', createExecStreamHandler());
  hostA.registry.register('msg', (stream) => {
    msgStreamsOnA.push(stream);
    stream.onData((data) => stream.write(data));
    // Every real handler acks its own open (pty-handler, exec-handler,
    // the mailbox's inbound receiver); `openStream` waits for it.
    stream.control({ kind: 'opened' });
  });
  await hostA.listen();
});

afterEach(async () => {
  for (const connection of openConnections.splice(0)) connection.close();
  await hostA.close();
  rmSync(dirA, { recursive: true, force: true });
  rmSync(dirB, { recursive: true, force: true });
});

/** B pairs with A over a URL whose token grants `scopes`, then dials. */
async function pairAndDial(
  scopes?: readonly StreamScope[]
): Promise<{ connection: PeerConnection; granted: readonly StreamScope[] }> {
  const { url } = hostA.issuePairingUrl(scopes);
  const { granted } = await pair(url, peersB, { identity: identityB });
  return { connection: await dialA(), granted };
}

async function dialA(): Promise<PeerConnection> {
  const connection = await dial(hostA.baseUrl, identityA.peerId, {
    identity: identityB,
    peers: peersB,
  });
  openConnections.push(connection);
  return connection;
}

/** Open a stream and return the error it was refused with, failing the
 * test if it opened instead. */
async function refusalFor(
  connection: PeerConnection,
  name: string,
  params?: Record<string, unknown>
): Promise<unknown> {
  try {
    const stream = await connection.openStream(name, params);
    stream.close();
    throw new Error(`'${name}' opened, but should have been refused`);
  } catch (error) {
    return error;
  }
}

/** The positive control every refusal in this file is paired with: prove
 * the connection is alive and serving by round-tripping a byte over a
 * stream the peer *is* granted. */
async function proveConnectionAlive(connection: PeerConnection): Promise<void> {
  const before = msgStreamsOnA.length;
  const stream = await connection.openStream('msg');
  const echoed = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no echo')), 5000);
    stream.onData((data) => {
      clearTimeout(timer);
      resolve(new TextDecoder().decode(data));
    });
    stream.write(new TextEncoder().encode('alive?'));
  });
  expect(echoed).toBe('alive?');
  expect(msgStreamsOnA.length).toBe(before + 1);
  stream.close();
}

describe('scoped pairing, end to end', () => {
  it('refuses a pty to a peer paired for msg only, while its msg stream on the same connection still works', async () => {
    const { connection, granted } = await pairAndDial(['msg']);
    expect(granted).toEqual(['msg']);

    const error = await refusalFor(connection, 'pty');
    expect(error).toBeInstanceOf(StreamScopeError);
    expect((error as StreamScopeError).scope).toBe('pty');

    // The control: had the pty refusal actually been a dead connection,
    // this would fail too.
    await proveConnectionAlive(connection);
  });

  it('refuses exec, and refuses pty:<program> as the pty it is', async () => {
    const { connection } = await pairAndDial(['msg']);

    const execError = await refusalFor(connection, 'exec', {
      argv: ['/bin/echo', 'hi'],
    });
    expect(execError).toBeInstanceOf(StreamScopeError);
    expect((execError as StreamScopeError).scope).toBe('exec');

    // `pty:bash` is not a different stream kind with a different grant.
    const ptyError = await refusalFor(connection, 'pty:bash');
    expect(ptyError).toBeInstanceOf(StreamScopeError);
    expect((ptyError as StreamScopeError).scope).toBe('pty');

    await proveConnectionAlive(connection);
  });

  it('a refusal is not a transport failure: the same stream fails differently once the connection is gone', async () => {
    const { connection } = await pairAndDial(['msg']);

    // Refused while healthy.
    const refused = await refusalFor(connection, 'pty');
    expect(refused).toBeInstanceOf(StreamScopeError);
    await proveConnectionAlive(connection);

    // The same call on a dead connection: an error, but a different one,
    // and about a stream this peer *is* granted.
    connection.terminate('test tore the transport down');
    const dead = await refusalFor(connection, 'msg');
    expect(dead).toBeInstanceOf(Error);
    expect(dead).not.toBeInstanceOf(StreamScopeError);
    expect((dead as Error).message).toContain('connection is closed');
  });

  it('grants all three by default, and a pty opened under them is a real shell', async () => {
    const { connection, granted } = await pairAndDial();
    expect(granted).toEqual(['pty', 'exec', 'msg']);

    const pty = await connection.openStream('pty');
    const chunks: string[] = [];
    pty.onData((data) => chunks.push(new TextDecoder().decode(data)));
    pty.write(new TextEncoder().encode('echo beam-scope-marker-7\n'));
    await waitFor(() => chunks.join('').includes('beam-scope-marker-7'));
    pty.close();

    const exec = await connection.openStream('exec', {
      argv: ['/bin/echo', 'scoped'],
    });
    const exit = await new Promise<string | undefined>((resolve) =>
      exec.onClose(resolve)
    );
    expect(exit).toContain('"exitCode":0');

    await proveConnectionAlive(connection);
  });

  it('an explicit grant of all three behaves exactly as the default', async () => {
    const { connection, granted } = await pairAndDial(['pty', 'exec', 'msg']);
    expect(granted).toEqual(['pty', 'exec', 'msg']);
    const pty = await connection.openStream('pty');
    expect(pty.name).toBe('pty');
    pty.close();
    await proveConnectionAlive(connection);
  });

  it('a legacy peers.json record with no scopes field grants everything', async () => {
    const { connection } = await pairAndDial(['msg']);
    // Confirm the narrowed grant is in force first, so the assertion after
    // the rewrite is a change and not a constant.
    expect(await refusalFor(connection, 'pty')).toBeInstanceOf(
      StreamScopeError
    );
    connection.close();

    stripScopesFromDisk(dirA);
    peersA.reload();

    const reconnected = await dialA();
    const pty = await reconnected.openStream('pty');
    expect(pty.name).toBe('pty');
    pty.close();
    await proveConnectionAlive(reconnected);
  });

  it('a grant belongs to the peer, not to the connection: it survives a reconnect', async () => {
    const { connection } = await pairAndDial(['msg']);
    expect(await refusalFor(connection, 'pty')).toBeInstanceOf(
      StreamScopeError
    );
    connection.close();

    const reconnected = await dialA();
    const again = await refusalFor(reconnected, 'pty');
    expect(again).toBeInstanceOf(StreamScopeError);
    expect((again as StreamScopeError).scope).toBe('pty');
    await proveConnectionAlive(reconnected);
  });

  it('takes a scope away on a live connection, without waiting for a reconnect', async () => {
    const { connection } = await pairAndDial();
    const pty = await connection.openStream('pty');
    pty.close();

    peersA.upsert({
      peerId: identityB.peerId,
      label: 'laptop',
      publicKeyPem: identityB.publicKeyPem,
      endpoints: [],
      scopes: ['msg'],
    });

    const error = await refusalFor(connection, 'pty');
    expect(error).toBeInstanceOf(StreamScopeError);
    await proveConnectionAlive(connection);
  });

  it('a re-pair narrows and never widens, even with a token granting more', async () => {
    const { connection, granted } = await pairAndDial(['msg']);
    expect(granted).toEqual(['msg']);
    connection.close();

    // A second pairing URL granting everything — what a captured pairing
    // link would buy an already-paired peer if widening were possible.
    const { url } = hostA.issuePairingUrl(['pty', 'exec', 'msg']);
    const { granted: after } = await pair(url, peersB, {
      identity: identityB,
      force: true,
    });
    expect(after).toEqual(['msg']);

    const reconnected = await dialA();
    expect(await refusalFor(reconnected, 'pty')).toBeInstanceOf(
      StreamScopeError
    );
    await proveConnectionAlive(reconnected);
  });
});

/** Rewrite A's peers.json as a beam that predates this field would have
 * written it: every record, minus `scopes`. */
function stripScopesFromDisk(beamDir: string): void {
  const path = join(beamDir, 'peers.json');
  const records = JSON.parse(readFileSync(path, 'utf8')) as Record<
    string,
    unknown
  >[];
  for (const record of records) delete record['scopes'];
  expect(records.some((r) => 'scopes' in r)).toBe(false);
  writeFileSync(path, JSON.stringify(records, null, 2));
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 5000
): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs)
      throw new Error('timed out waiting for pty output');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
