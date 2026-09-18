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
}

/** This machine's accept-connections state — the "B" side of pairing. */
export interface AcceptingStatus {
  accepting: boolean;
  /** `host:port` while accepting; null otherwise. */
  boundAddress: string | null;
  /** Carries the current single-use pairing token; null while not
   *  accepting, or once it has expired (regenerate to get a new one). */
  pairingUrl: string | null;
  pairingExpiresAt: number | null;
  /** Live connections right now — shown when turning accepting off, so
   *  the user knows whether that drops anyone. */
  connectedCount: number;
}

/** What `previewPairing`/`confirmPairing` found before anything is
 *  stored — the fingerprint the two-step confirm exists to show. */
export interface PairPreview {
  label: string;
  peerId: string;
  endpoint: string;
}

export type PairFailureReason =
  | 'invalid-url'
  | 'unreachable'
  | 'invalid-token'
  | 'key-mismatch'
  | 'protocol-mismatch';

export interface PairFailure {
  reason: PairFailureReason;
  /** Actionable, specific text — never "something went wrong". */
  message: string;
  /** Present only for `key-mismatch`: the id and the label we already
   *  hold it under, for the "reinstall or impostor" explanation. */
  peerId?: string;
  existingLabel?: string;
}

export type PairPreviewResult =
  | { ok: true; preview: PairPreview }
  | { ok: false; failure: PairFailure };

export type PairConfirmResult =
  | { ok: true; machine: MachineView }
  | { ok: false; failure: PairFailure };
