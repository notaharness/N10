/**
 * `beam peer rename <peer> <label>` / `beam peer forget <peer>` (D9).
 * Both act directly on the peer table on disk — no live connection needed.
 */

import { PeerTable } from '@n10/beam';
import { beamDirFor } from '../context.js';
import type { Io } from '../io.js';
import { resolvePeer } from '../peer-resolve.js';
import { UsageError } from '../usage.js';

export async function runPeer(args: string[], io: Io): Promise<number> {
  const [sub, ...rest] = args;
  if (sub === 'rename') return runRename(rest, io);
  if (sub === 'forget') return runForget(rest, io);
  throw new UsageError(
    `usage: beam peer rename <peer> <label>\n       beam peer forget <peer>`
  );
}

function runRename(args: string[], io: Io): number {
  const [nameOrId, newLabel] = args;
  if (!nameOrId || !newLabel) {
    throw new UsageError('usage: beam peer rename <peer> <label>');
  }
  const peers = new PeerTable(beamDirFor(io));
  const peer = resolvePeer(peers, nameOrId);
  peers.rename(peer.peerId, newLabel);
  io.stdout.write(
    `renamed "${peer.label}" to "${newLabel}" (${peer.peerId})\n`
  );
  return 0;
}

function runForget(args: string[], io: Io): number {
  const [nameOrId] = args;
  if (!nameOrId) throw new UsageError('usage: beam peer forget <peer>');
  const peers = new PeerTable(beamDirFor(io));
  const peer = resolvePeer(peers, nameOrId);
  peers.remove(peer.peerId);
  io.stdout.write(`forgot "${peer.label}" (${peer.peerId})\n`);
  return 0;
}
