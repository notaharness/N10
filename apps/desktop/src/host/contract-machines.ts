/**
 * Machines: other n10 hosts paired over beam, plus this one's own
 * identity and accept-connections state. Split from `contract.ts`
 * because it is one subject, and because that file is a catalogue
 * already.
 *
 * D6 (docs/decisions.md) fixes five reachability states, `revoked`
 * shown separately. Two of them are not faults: `no-endpoint` is a
 * normal, permanent condition for a laptop that only dials out;
 * `unknown` means "paired, not yet probed" and must never render as
 * `unreachable`.
 */

export type MachineState =
  | 'connected'
  | 'reachable'
  | 'unreachable'
  | 'unknown'
  | 'no-endpoint'
  | 'revoked';

/** One report from this machine, either waiting for its target session
 *  to connect or refused delivery — the inbound half of the mailbox
 *  relay (decisions.md D13/D14). `reason` is set only for
 *  a refused item; a waiting one carries none because waiting is not a
 *  failure. */
export interface InboundMailItem {
  id: string;
  /** The envelope's local target, e.g. `tmux:n10-feature-x` — shown
   *  beside the reason, never the raw peerId. */
  target: string;
  reason?: string;
  receivedAt: number;
}

/** One row of the machines list — the local machine, or a paired peer. */
export interface MachineView {
  /** beam peerId — the fingerprint, grouped in fours for display. */
  peerId: string;
  label: string;
  isLocal: boolean;
  state: MachineState;
  /** Set while `state === 'connected'`; null otherwise. */
  transport: 'WebSocket' | 'WebRTC' | null;
  /** Where this machine may be dialed. Empty means `no-endpoint`. */
  endpoints: string[];
  lastSeenAt: number | null;
  /** Messages waiting for this peer — D7: part of its displayed state. */
  queueDepth: number;
  /** null for the local row, which was never "paired". */
  pairedAt: number | null;
  /** Set only once `state === 'revoked'`. */
  revokedAt: number | null;
  /** Reports from this machine known locally and waiting for their
   *  target session to connect. Oldest first. */
  inboundWaiting: InboundMailItem[];
  /** Reports from this machine refused delivery (D14: never a foreign
   *  session, a shell terminal, or one on another machine). Oldest
   *  first; each can be dismissed. */
  inboundRefused: InboundMailItem[];
}
