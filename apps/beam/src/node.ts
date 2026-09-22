/**
 * The two ways a command gets a working beam node: `startNode` builds the
 * full, long-lived thing `serve` runs (host + mailbox + local IPC socket);
 * `buildEphemeral` builds just enough state (identity, peer table, an
 * unconnected registry/connections pair) for a one-shot command that will
 * dial out itself — `exec`, `connect`, and `msg`/`status` when no running
 * node's socket answers. See docs/beam.md.
 */

import {
  ConnectionRegistry,
  Host,
  IpcSocket,
  Mailbox,
  PeerTable,
  StreamRegistry,
  createExecStreamHandler,
  createPtyStreamHandler,
  loadOrCreateIdentity,
  renameIdentity,
  type Identity,
  type MailboxOptions,
  type NodeEnvContext,
} from '@n10/beam';
import { beamDirFor, inboxSocketPath } from './context.js';
import type { Io } from './io.js';

export interface EphemeralContext {
  beamDir: string;
  identity: Identity;
  peers: PeerTable;
  registry: StreamRegistry;
  connections: ConnectionRegistry;
}

/** Identity, peer table, and an empty registry/connections pair — enough
 * for a command that resolves peers locally and then dials out itself.
 * Never touches the network or starts a server. */
export function buildEphemeral(io: Io): EphemeralContext {
  const beamDir = beamDirFor(io);
  const identity = loadOrCreateIdentity(beamDir);
  const peers = new PeerTable(beamDir);
  return {
    beamDir,
    identity,
    peers,
    registry: new StreamRegistry(),
    connections: new ConnectionRegistry(),
  };
}

/** A `Mailbox` over an ephemeral context, for `msg` commands that find no
 * running node. `sendAwaitMs` defaults short here (unlike the library's own
 * 5s default): an ephemeral `msg send` already knows, the instant it is
 * asked to wait, whether it has a live connection to try — there is no
 * reason to hold a one-shot CLI process open for the library's full
 * default window once that connection attempt has already resolved. */
export function ephemeralMailbox(
  ctx: EphemeralContext,
  overrides: Partial<MailboxOptions> = {}
): Mailbox {
  return new Mailbox({
    identity: ctx.identity,
    peers: ctx.peers,
    connections: ctx.connections,
    registry: ctx.registry,
    beamDir: ctx.beamDir,
    sendAwaitMs: 3_000,
    ...overrides,
  });
}

export interface NodeHandle {
  beamDir: string;
  identity: Identity;
  peers: PeerTable;
  registry: StreamRegistry;
  connections: ConnectionRegistry;
  host: Host;
  mailbox: Mailbox;
  ipcSocket: IpcSocket;
  close(): Promise<void>;
}

export interface StartNodeOptions {
  hostname?: string;
  port?: number;
  label?: string;
  /** Where this node may be dialled back; empty unless the caller can
   * compute a meaningful address (see `commands/serve.ts`). */
  endpoints?: string[];
  log?: (message: string) => void;
}

function nodeEnvContext(beamDir: string, ownPeerId: string): NodeEnvContext {
  return { beamDir, inboxSocketPath: inboxSocketPath(beamDir), ownPeerId };
}

/** Build and start the long-lived node `serve` runs: identity, peer table,
 * the host's HTTP/WebSocket surface, both stream handlers, the durable
 * mailbox, and the local IPC socket other processes talk to. */
export async function startNode(
  io: Io,
  options: StartNodeOptions = {}
): Promise<NodeHandle> {
  const beamDir = beamDirFor(io);
  const identity = resolveIdentity(beamDir, options.label);
  const peers = new PeerTable(beamDir);
  const registry = new StreamRegistry();
  const connections = new ConnectionRegistry();
  const log = options.log ?? (() => undefined);

  const host = new Host({
    identity,
    peers,
    registry,
    connections,
    hostname: options.hostname,
    port: options.port,
    endpoints: options.endpoints ?? [],
    capabilities: ['streams', 'pty', 'exec', 'msg'],
    log,
  });

  const env = nodeEnvContext(beamDir, identity.peerId);
  registry.register('pty', createPtyStreamHandler(env));
  registry.register('exec', createExecStreamHandler(env));

  const mailbox = new Mailbox({
    identity,
    peers,
    connections,
    registry,
    beamDir,
    log,
  });

  await host.listen();

  // Host.listen() has already resolved the real bind address (an
  // ephemeral `port: 0` included) by this point, so the local IPC `status`
  // op can report it directly — no CLI-private sidecar file needed.
  const ipcSocket = new IpcSocket({
    path: inboxSocketPath(beamDir),
    mailbox,
    peers,
    connections,
    bindAddress: `${host.hostname}:${host.port}`,
    log,
  });
  await ipcSocket.listen();

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    mailbox.dispose();
    await ipcSocket.close();
    await host.close();
  };

  return {
    beamDir,
    identity,
    peers,
    registry,
    connections,
    host,
    mailbox,
    ipcSocket,
    close,
  };
}

/** `loadOrCreateIdentity`'s own `hostname` option only ever names the
 * identity the first time it is created (deliberately: docs/beam.md/
 * identity.ts). A `--label` given on a later `serve` is therefore an
 * explicit rename request, applied through `renameIdentity` so it actually
 * takes effect rather than only producing a note that nothing happened. */
function resolveIdentity(beamDir: string, label: string | undefined): Identity {
  const identity = label
    ? loadOrCreateIdentity(beamDir, { hostname: () => label })
    : loadOrCreateIdentity(beamDir);
  if (label && identity.label !== label) return renameIdentity(beamDir, label);
  return identity;
}
