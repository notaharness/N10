/**
 * Dial a resolved peer over the first endpoint that answers — shared by
 * `exec`, `connect`, and the ephemeral fallback for `msg send`/`msg
 * listen`. Neither `exec` nor `connect` can fall back to anything but a
 * live stream (there is no "queued" outcome for a pty or a command), so a
 * peer with no endpoint, or one that answers nowhere, is a plain failure.
 */

import { dial, type PeerConnection, type PeerRecord } from '@n10/beam';
import type { EphemeralContext } from './node.js';
import { RuntimeError } from './usage.js';

export async function dialPeer(
  ctx: EphemeralContext,
  peer: PeerRecord
): Promise<PeerConnection> {
  if (peer.revoked) {
    throw new RuntimeError(
      `"${peer.label}" has been revoked and can no longer be dialed`
    );
  }
  if (peer.endpoints.length === 0) {
    throw new RuntimeError(
      `"${peer.label}" has no known endpoint — it cannot be dialed from here ` +
        `(it can still reach us if it dials in)`
    );
  }
  let lastError: unknown;
  for (const endpoint of peer.endpoints) {
    try {
      return await dial(endpoint, peer.peerId, {
        identity: ctx.identity,
        peers: ctx.peers,
        registry: ctx.registry,
        connections: ctx.connections,
      });
    } catch (error) {
      lastError = error;
    }
  }
  const reason =
    lastError instanceof Error ? lastError.message : String(lastError);
  throw new RuntimeError(
    `could not reach "${peer.label}" at any known endpoint: ${reason}`
  );
}
