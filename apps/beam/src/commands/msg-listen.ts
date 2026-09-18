/**
 * `beam msg listen [<peer>...] [--topic T] [--require-ack]` (D9/D13).
 *
 * Prefers the running node's socket, which is the only place the explicit
 * `--require-ack` hold-back-and-redeliver behaviour actually lives (the
 * `IpcSocket`'s own pending/current queue — see docs/beam.md's
 * "Acknowledging a subscription"). Without a running node there is no such
 * local queue to hold anything in, so `--require-ack` refuses rather than
 * silently doing nothing: an ephemeral listen always acks on receipt.
 *
 * The socket's `subscribe` op filters by topic only, never by peer
 * (docs/beam.md's local-IPC protocol has no peer filter). An envelope from
 * a peer outside `[<peer>...]` is acked immediately without being printed
 * — "acked but not ours" rather than left to jam the socket's single
 * outstanding-envelope pump for every other subscriber.
 */

import type { Socket } from 'node:net';
import { PeerTable } from '@n10/beam';
import { parseArgs } from '../args.js';
import { beamDirFor, inboxSocketPath } from '../context.js';
import { dialPeer } from '../dial-peer.js';
import { printJson } from '../fmt/json.js';
import type { Io } from '../io.js';
import { IpcLineClient, connectToRunningNode } from '../ipc-client.js';
import { buildEphemeral, ephemeralMailbox } from '../node.js';
import { resolvePeer } from '../peer-resolve.js';
import { RuntimeError } from '../usage.js';

export async function runMsgListen(args: string[], io: Io): Promise<number> {
  const parsed = parseArgs(args, {
    valueFlags: ['topic'],
    booleanFlags: ['require-ack'],
  });
  const requireAck = parsed.booleans.has('require-ack');
  const topic = parsed.values.get('topic');
  const beamDir = beamDirFor(io);
  const peers = new PeerTable(beamDir);
  const wantedPeerIds =
    parsed.positionals.length > 0
      ? new Set(
          parsed.positionals.map((name) => resolvePeer(peers, name).peerId)
        )
      : null;

  const socket = await connectToRunningNode(inboxSocketPath(beamDir));
  if (socket) {
    return listenViaSocket(io, socket, { topic, wantedPeerIds, requireAck });
  }
  if (requireAck) {
    throw new RuntimeError(
      'msg listen --require-ack needs a running node — start one with "beam serve" first. ' +
        'A one-shot listen has no local queue to hold an unacknowledged envelope in for redelivery.'
    );
  }
  return listenEphemeral(io, peers, parsed.positionals, topic);
}

interface SocketOptions {
  topic?: string;
  wantedPeerIds: Set<string> | null;
  requireAck: boolean;
}

function listenViaSocket(
  io: Io,
  socket: Socket,
  opts: SocketOptions
): Promise<number> {
  return new Promise((resolve) => {
    let stopped = false;
    let pendingAckId: string | null = null;

    const onStdinData = (chunk: Buffer | string): void => {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      for (const line of text.split('\n')) {
        if (line.trim() && pendingAckId) {
          client.send({ op: 'ack', id: pendingAckId });
          pendingAckId = null;
        }
      }
    };

    const stop = (): void => {
      if (stopped) return;
      stopped = true;
      process.removeListener('SIGINT', stop);
      process.removeListener('SIGTERM', stop);
      io.stdin.removeListener?.(
        'data',
        onStdinData as (...a: unknown[]) => void
      );
      client.close();
      resolve(0);
    };

    const handleLine = (line: Record<string, unknown>): void => {
      const id = line['id'];
      const from = line['from'];
      if (typeof id !== 'string' || typeof from !== 'string') return;
      if (opts.wantedPeerIds && !opts.wantedPeerIds.has(from)) {
        client.send({ op: 'ack', id });
        return;
      }
      printJson(io.stdout, line);
      if (opts.requireAck) pendingAckId = id;
      else client.send({ op: 'ack', id });
    };

    const client = new IpcLineClient(socket, handleLine);
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    io.signal?.addEventListener('abort', stop, { once: true });
    if (opts.requireAck) io.stdin.on('data', onStdinData);

    client.send({
      op: 'subscribe',
      ...(opts.topic ? { topic: opts.topic } : {}),
    });
  });
}

async function listenEphemeral(
  io: Io,
  peers: PeerTable,
  peerNames: string[],
  topic: string | undefined
): Promise<number> {
  const ctx = buildEphemeral(io);
  const targets =
    peerNames.length > 0
      ? peerNames.map((name) => resolvePeer(ctx.peers, name))
      : peers
          .list()
          .filter((peer) => !peer.revoked && peer.endpoints.length > 0);

  const mailbox = ephemeralMailbox(ctx);
  const unsubscribe = mailbox.onMessage((envelope) => {
    if (topic && envelope.topic !== topic) return;
    printJson(io.stdout, envelope);
  });

  for (const peer of targets) {
    try {
      await dialPeer(ctx, peer);
    } catch (error) {
      io.stderr.write(
        `beam: could not reach "${peer.label}": ${(error as Error).message}\n`
      );
    }
  }

  return new Promise<number>((resolve) => {
    const stop = (): void => {
      process.removeListener('SIGINT', stop);
      process.removeListener('SIGTERM', stop);
      unsubscribe();
      mailbox.dispose();
      for (const connection of ctx.connections.list()) connection.close();
      resolve(0);
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    io.signal?.addEventListener('abort', stop, { once: true });
  });
}
