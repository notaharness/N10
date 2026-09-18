/**
 * `beam peer rename <peer> <label>` / `beam peer forget <peer>` (D9).
 * Prefers a running node's local IPC socket, so the change is applied to
 * its live `PeerTable` immediately rather than waiting for a restart to
 * re-read peers.json; falls back to a direct file write when no node
 * answers.
 */

import { PeerTable } from '@n10/beam';
import { beamDirFor, inboxSocketPath } from '../context.js';
import type { Io } from '../io.js';
import { connectToRunningNode, requestOnce } from '../ipc-client.js';
import { resolvePeer } from '../peer-resolve.js';
import { RuntimeError, UsageError } from '../usage.js';

export async function runPeer(args: string[], io: Io): Promise<number> {
  const [sub, ...rest] = args;
  if (sub === 'rename') return runRename(rest, io);
  if (sub === 'forget') return runForget(rest, io);
  throw new UsageError(
    `usage: beam peer rename <peer> <label>\n       beam peer forget <peer>`
  );
}

async function runRename(args: string[], io: Io): Promise<number> {
  const [nameOrId, newLabel] = args;
  if (!nameOrId || !newLabel) {
    throw new UsageError('usage: beam peer rename <peer> <label>');
  }
  const beamDir = beamDirFor(io);
  const peers = new PeerTable(beamDir);
  const peer = resolvePeer(peers, nameOrId);

  const socket = await connectToRunningNode(inboxSocketPath(beamDir));
  let finalLabel = newLabel;
  if (socket) {
    const response = await requestOnce(socket, {
      op: 'rename',
      peer: peer.peerId,
      label: newLabel,
    });
    socket.end();
    if (response['status'] !== 'ok') {
      throw new RuntimeError(
        `could not rename "${peer.label}": ${String(response['reason'])}`
      );
    }
    finalLabel = String(response['label']);
  } else {
    finalLabel = peers.rename(peer.peerId, newLabel).label;
  }
  io.stdout.write(
    `renamed "${peer.label}" to "${finalLabel}" (${peer.peerId})\n`
  );
  return 0;
}

async function runForget(args: string[], io: Io): Promise<number> {
  const [nameOrId] = args;
  if (!nameOrId) throw new UsageError('usage: beam peer forget <peer>');
  const beamDir = beamDirFor(io);
  const peers = new PeerTable(beamDir);
  const peer = resolvePeer(peers, nameOrId);

  const socket = await connectToRunningNode(inboxSocketPath(beamDir));
  if (socket) {
    const response = await requestOnce(socket, {
      op: 'forget',
      peer: peer.peerId,
    });
    socket.end();
    if (response['status'] !== 'ok') {
      throw new RuntimeError(
        `could not forget "${peer.label}": ${String(response['reason'])}`
      );
    }
  } else {
    peers.remove(peer.peerId);
  }
  io.stdout.write(`forgot "${peer.label}" (${peer.peerId})\n`);
  return 0;
}
