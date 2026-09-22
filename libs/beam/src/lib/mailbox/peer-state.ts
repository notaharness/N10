/**
 * D6's peer reachability states, and the (conservative) rule for deriving
 * them from what this phase actually knows. `revoked` is orthogonal and
 * shown separately, never folded into this. See decisions.md.
 */

import type { PeerRecord } from '../peer-table.js';

export type PeerState =
  | 'connected'
  | 'reachable'
  | 'unreachable'
  | 'no-endpoint'
  | 'unknown';

/**
 * `connected` and `no-endpoint` are answerable with certainty from what
 * this library tracks today (a live connection, and whether any endpoint is
 * known). `reachable`/`unreachable` require an active probe this phase does
 * not implement — no prober exists yet — so a peer with a known endpoint
 * that simply has not been probed reports `unknown` (D4), not a guessed
 * `unreachable`: a laptop that has never dialed a paired worker box is not
 * at fault, and reporting it `unreachable` would read as a live problem and
 * invite the user to re-pair a perfectly healthy machine. A caller that
 * does implement a probe passes its result to get an honest
 * `reachable`/`unreachable` split instead.
 */
export function derivePeerState(
  peer: Pick<PeerRecord, 'endpoints'>,
  connected: boolean,
  probe?: 'reachable' | 'unreachable'
): PeerState {
  if (connected) return 'connected';
  if (peer.endpoints.length === 0) return 'no-endpoint';
  return probe ?? 'unknown';
}
