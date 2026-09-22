/**
 * What `beam connect` exits with, against a real peer running a real
 * `Host` with a real pty handler — because the whole question is which
 * close reason the far side produced, and a fake stream is only ever as
 * truthful as the reason its author remembered to write.
 *
 * The case that matters is the connection dying under a live shell. That
 * is not a stream ending politely: the transport goes, every stream on it
 * is reaped, and the reason the opener sees says nothing about a process.
 * Exiting 0 there tells a script the shell ran to completion when it was
 * cut off partway — and the exit code is the only thing a script can read.
 *
 * Each test proves the shell was live before anything is dropped, so
 * "the connection died mid-shell" is true of the run rather than assumed.
 */

import { rmSync } from 'node:fs';
import {
  ConnectionRegistry,
  Host,
  PeerTable,
  StreamRegistry,
  createPtyStreamHandler,
  loadOrCreateIdentity,
  pair,
  type Identity,
} from '@n10/beam';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runConnect } from './connect.js';
import {
  makeFakeIo,
  makeFakeIoWithBeamDir,
  waitFor,
  type FakeIo,
} from '../test-support/fake-io.js';

interface Peer {
  host: Host;
  identity: Identity;
  connections: ConnectionRegistry;
}

let hostDir: string;
let clientDir: string;
let peer: Peer;
let clientIo: FakeIo;
let clientPeerId: string;

beforeEach(async () => {
  ({ beamDir: hostDir } = makeFakeIoWithBeamDir('beam-connect-host-'));
  ({ beamDir: clientDir } = makeFakeIoWithBeamDir('beam-connect-client-'));

  const identity = loadOrCreateIdentity(hostDir, {
    hostname: () => 'workbox',
  });
  const peers = new PeerTable(hostDir);
  const registry = new StreamRegistry();
  const connections = new ConnectionRegistry();
  registry.register('pty', createPtyStreamHandler());
  const host = new Host({
    identity,
    peers,
    registry,
    connections,
    port: 0,
    capabilities: ['streams', 'pty'],
  });
  await host.listen();
  peer = { host, identity, connections };

  const clientIdentity = loadOrCreateIdentity(clientDir, {
    hostname: () => 'laptop',
  });
  clientPeerId = clientIdentity.peerId;
  const clientPeers = new PeerTable(clientDir);
  await pair(host.issuePairingUrl().url, clientPeers, {
    identity: clientIdentity,
  });
  // Loopback is deliberately never advertised by `serve`, so the endpoint
  // a real deployment would carry has to be written in here.
  clientPeers.setEndpoints(identity.peerId, [host.baseUrl]);

  clientIo = makeFakeIo({ BEAM_CONFIG_DIR: clientDir });
});

afterEach(async () => {
  await peer.host.close();
  rmSync(hostDir, { recursive: true, force: true });
  rmSync(clientDir, { recursive: true, force: true });
});

/** Run `beam connect` against the peer with `argv` as the remote command,
 * without awaiting it. */
function connect(argv: string[]): Promise<number> {
  return runConnect([peer.identity.peerId, 'pty', '--', ...argv], clientIo);
}

/** Block until the remote shell has actually written to us. Everything
 * else here is "and then the connection died", which is only meaningful
 * once there is a live shell for it to die under. */
async function awaitOutput(marker: string): Promise<void> {
  await waitFor(
    () => Promise.resolve(clientIo.stdoutText()),
    (text) => text.includes(marker)
  );
}

describe('beam connect: how the session ended decides the exit code', () => {
  it(
    'exits 1 and says so when the connection dies under a live shell',
    { timeout: 20_000 },
    async () => {
      const running = connect(['sh', '-c', 'echo LIVE; sleep 30']);
      await awaitOutput('LIVE');

      // The peer goes away without a word — no close handshake, which is
      // what a machine that is switched off, unplugged or killed looks
      // like from this end. `terminate` is how the library expresses
      // exactly that (docs/beam.md's "Liveness").
      const accepted = peer.connections.get(clientPeerId);
      expect(accepted).toBeDefined();
      accepted?.terminate('peer went away');

      expect(await running).toBe(1);
      expect(clientIo.stderrText()).toContain(
        'connection to the remote terminal ended'
      );
    }
  );

  it(
    'exits 0 in silence when the remote process ends on its own',
    { timeout: 20_000 },
    async () => {
      // The control the assertion above needs beside it. Same command,
      // same wiring, same pty handler — only the way the stream ends
      // differs, so an exit code of 1 cannot be coming from the setup.
      expect(await connect(['sh', '-c', 'echo LIVE; exit 0'])).toBe(0);
      expect(clientIo.stdoutText()).toContain('LIVE');
      expect(clientIo.stderrText()).toBe('');
    }
  );

  it(
    'exits 1 when the remote process ends on a signal, and names it',
    { timeout: 20_000 },
    async () => {
      // A shell killed by a signal is not the session finishing either.
      // Its close reason does decode, so this is the case that separates
      // "decoded an exit" from "exited cleanly".
      const running = connect(['sh', '-c', 'echo LIVE; kill -TERM $$']);
      await awaitOutput('LIVE');
      expect(await running).toBe(1);
      expect(clientIo.stderrText()).toContain('signal');
    }
  );
});
