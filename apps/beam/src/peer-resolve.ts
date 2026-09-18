/**
 * `<peer>` resolution shared by every command that takes one: a peerId or a
 * label (D9). Peer records themselves can never collide on label
 * (`PeerTable.upsert` enforces uniqueness by appending `-2`, `-3`, ...), so
 * the only way to hit a genuine ambiguity is a string that happens to be
 * both one peer's id and a different peer's label — reported clearly
 * rather than silently preferring one over the other.
 */

import type { PeerRecord, PeerTable } from '@n10/beam';
import { RuntimeError } from './usage.js';

export function resolvePeer(peers: PeerTable, nameOrId: string): PeerRecord {
  const byId = peers.get(nameOrId);
  const byLabel = peers.list().find((peer) => peer.label === nameOrId);
  if (byId && byLabel && byId.peerId !== byLabel.peerId) {
    throw new RuntimeError(
      `"${nameOrId}" is ambiguous — it is both peer id ${byId.peerId} (labelled "${byId.label}") ` +
        `and the label of peer ${byLabel.peerId}. Use the full peer id to disambiguate.`
    );
  }
  const match = byId ?? byLabel;
  if (!match) {
    throw new RuntimeError(
      `unknown peer "${nameOrId}" — run "beam peers" to see known peers`
    );
  }
  return match;
}
