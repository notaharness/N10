/**
 * Everything that makes an inbound `Open` refusable, in one place.
 *
 * `Open` is the single gate every stream passes through, and the one frame
 * type whose effect outlives the connection — it spawns a process. The
 * checks are gathered here rather than inlined in the muxer so that the
 * whole of "may this peer open this, right now" reads as one list, and so
 * adding one (as scopes did) does not mean adding another early return to
 * a method that already had three.
 *
 * Each answer is the close reason the peer is sent. See docs/beam.md.
 */

import {
  missingScope,
  scopeRefusalReason,
  type StreamScope,
} from './peer-scopes.js';

export interface OpenConditions {
  /** The connection has been reaped. A transport is not dead the moment
   * this side is finished with it — a graceful WebSocket close is a
   * handshake the peer can decline, and `ws` keeps delivering frames for
   * the whole of its 30s close timeout while it waits — so `Open` is
   * refused in its own right as well as being dropped by `receive`. */
  disposed: boolean;
  /** Stream ids are partitioned by role (the dialer allocates odd ids, the
   * acceptor even ones) so two simultaneous opens cannot collide; an id
   * from the wrong half is not the opener's to allocate. */
  ownedByPeer: boolean;
  alreadyOpen: boolean;
  /** What the peer is entitled to open here, or `undefined` for a caller
   * that enforces no scopes at all (tests, and anything with no peer
   * table). See peer-scopes.ts. */
  granted?: readonly StreamScope[];
}

/**
 * The reason to refuse this `Open`, or `undefined` to serve it.
 *
 * The scope check runs before the stream registry is consulted, so a peer
 * that lacks a scope gets the same answer whether or not this node happens
 * to serve that stream — and long before anything spawns.
 */
export function openRefusal(
  conditions: OpenConditions,
  name: string
): string | undefined {
  if (conditions.disposed) return 'connection is closed';
  if (!conditions.ownedByPeer)
    return "stream id is not the opener's to allocate";
  if (conditions.alreadyOpen) return 'stream id already open';
  const ungranted =
    conditions.granted && missingScope(name, conditions.granted);
  return ungranted ? scopeRefusalReason(ungranted) : undefined;
}
