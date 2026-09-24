/**
 * Machines: this one and the other members of its beam fleet, as the
 * beam daemon reports them (beam docs/06, `PeerView`), plus enrolment.
 * Split from `contract.ts` because it is one subject, and because that
 * file is a catalogue already.
 */

/** beam's peer states. `revoked-by-fleet` is the peer refusing this
 *  machine as revoked: it will not take this machine again. */
export type MachineState =
  | 'connected'
  | 'offline'
  | 'revoked'
  | 'revoked-by-fleet';

/** What this machine lets a peer open here: `all` is a shell as your
 *  user, `msg` only mail, `none` nothing (beam docs/04, Grants). */
export type MachineGrant = 'all' | 'msg' | 'none';

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

/** One row of the machines list — this machine, or a fleet member. */
export interface MachineView {
  /** beam peerId — the fingerprint, grouped in fours for display. */
  peerId: string;
  /** The alias when one is set here, else the machine's own label. */
  label: string;
  isLocal: boolean;
  state: MachineState;
  /** `direct`, `relay <region>` or `unknown`; null for this machine. */
  path: string | null;
  lastSeenAt: number | null;
  grant: MachineGrant;
  /** Mail waiting here to go to the peer. */
  queued: number;
  /** Reports from this machine known locally and waiting for their
   *  target session to connect. Oldest first. */
  inboundWaiting: InboundMailItem[];
  /** Reports from this machine refused delivery (D14: never a foreign
   *  session, a shell terminal, or one on another machine). Oldest
   *  first; each can be dismissed. */
  inboundRefused: InboundMailItem[];
}

/** The beam daemon as the desktop sees it. `starting` is a first
 *  connection whose socket answers while beam still brings up its
 *  transport (every op but `status` waits for it); `restarting` is an
 *  unexpected loss being retried; `unavailable` says why in `detail`. */
export interface BeamStatus {
  state: 'connecting' | 'starting' | 'ready' | 'restarting' | 'unavailable';
  detail: string | null;
  enrolled: boolean;
  /** The fleet this machine belongs to, as beam's `status` last said. */
  fleetId: string | null;
}

/** beam's `directory.published` event: a queued membership (`member`)
 *  or revocation (`revoke`) write for `peerId` reached the directory. */
export interface DirectoryPublished {
  kind: string;
  peerId: string;
}

/** A passkey ceremony (beam docs/02, Flows): create the fleet on its
 *  first machine, join another machine to it, or revoke a member. */
export type CeremonyRequest =
  | { op: 'init'; label: string; fleetName: string }
  | { op: 'join'; label: string }
  | { op: 'revoke'; peerId: string };

/** Pushed while a ceremony runs. `passkey` carries the URL the owner's
 *  browser or phone opens; `stage` names what the daemon does now. */
export type CeremonyProgress =
  | { kind: 'passkey'; step: 'create' | 'sign'; ceremonyUrl: string }
  | { kind: 'stage'; stage: string };

export type CeremonyOutcome =
  | {
      ok: true;
      op: 'init';
      fleetId: string;
      peerId: string;
      published: boolean;
    }
  | {
      ok: true;
      op: 'join';
      /** This machine, as enrolled. */
      peerId: string;
      fleetId: string;
      members: number;
      published: boolean;
    }
  | {
      ok: true;
      op: 'revoke';
      /** The machine revoked. */
      peerId: string;
      published: boolean;
      acknowledgedBy: number;
    }
  | BeamFailure;

/** A refused operation. `code` is beam's error token (docs/06), or
 *  `connection-lost` when the connection dropped mid-request; `detail`
 *  is beam's own words. The renderer owns what each tells the owner. */
export interface BeamFailure {
  ok: false;
  code: string;
  detail: string | null;
}

/** `fleet.reset` (beam docs/06): this machine leaves its fleet, keeping
 *  its identity. */
export type FleetResetOutcome = { ok: true } | BeamFailure;
