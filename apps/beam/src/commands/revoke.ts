/**
 * `beam revoke <peer>` (D9). Marks the peer revoked in the peer table —
 * kept, never matched, never dialed again (docs/beam.md), and, if a node is
 * running, applied to its live `PeerTable` over the local IPC socket so
 * revocation is immediate rather than waiting for a restart: docs/beam.md
 * says a revoked peer fails authentication right away, and a node that
 * keeps serving a revoked peer until it happens to restart does not meet
 * that. Falls back to a direct file write only when no node answers.
 */

import { PeerTable } from '@n10/beam';
import { beamDirFor, inboxSocketPath } from '../context.js';
import type { Io } from '../io.js';
import { connectToRunningNode, requestOnce } from '../ipc-client.js';
import { resolvePeer } from '../peer-resolve.js';
import { RuntimeError, UsageError } from '../usage.js';

export async function runRevoke(args: string[], io: Io): Promise<number> {
  const [nameOrId] = args;
  if (!nameOrId) throw new UsageError('usage: beam revoke <peer>');
  const beamDir = beamDirFor(io);
  const peers = new PeerTable(beamDir);
  const peer = resolvePeer(peers, nameOrId);

  const socket = await connectToRunningNode(inboxSocketPath(beamDir));
  if (socket) {
    const response = await requestOnce(socket, {
      op: 'revoke',
      peer: peer.peerId,
    });
    socket.end();
    if (response['status'] !== 'ok') {
      throw new RuntimeError(
        `could not revoke "${peer.label}": ${String(response['reason'])}`
      );
    }
  } else {
    peers.revoke(peer.peerId);
  }

  io.stdout.write(
    `revoked "${peer.label}" (${peer.peerId}) — it can no longer authenticate.\n`
  );
  return 0;
}
