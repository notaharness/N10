/**
 * `beam revoke <peer>` (D9). Marks the peer revoked in the peer table —
 * kept, never matched, never dialed again (docs/beam.md). Note: the local
 * IPC protocol has no admin op for this, so an already-running `serve`
 * node only picks up a revocation from a fresh `PeerTable` read on its next
 * restart; it does not hot-reload peers.json. See the phase-3 report for
 * why that gap was left rather than patched into the wire protocol here.
 */

import { PeerTable } from '@n10/beam';
import { beamDirFor } from '../context.js';
import type { Io } from '../io.js';
import { resolvePeer } from '../peer-resolve.js';
import { UsageError } from '../usage.js';

export async function runRevoke(args: string[], io: Io): Promise<number> {
  const [nameOrId] = args;
  if (!nameOrId) throw new UsageError('usage: beam revoke <peer>');
  const peers = new PeerTable(beamDirFor(io));
  const peer = resolvePeer(peers, nameOrId);
  peers.revoke(peer.peerId);
  io.stdout.write(
    `revoked "${peer.label}" (${peer.peerId}) — it can no longer authenticate.\n`
  );
  return 0;
}
