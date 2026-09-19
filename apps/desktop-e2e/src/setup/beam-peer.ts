import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  derivePeerId,
  Host,
  PeerTable,
  type Envelope,
  type Identity,
  type PeerRecord,
} from '@n10/beam';
import {
  beamDirIn,
  deterministicKeypair,
  fingerprint,
} from './beam-identity.js';

/**
 * A second, real machine for the machines visual suite — see
 * `docs/testing.md`'s `@visual` paragraph for why this exists instead
 * of a mock: `machines.test.ts` already turned down faking the remote
 * side at the IPC layer ("proves the mock, not the feature"), and a
 * `Host` from `@n10/beam` speaks the actual descriptor/pairing wire
 * protocol on a real loopback port, so pairing with it and being probed
 * by it are the genuine thing, not a stand-in for it.
 *
 * What it does *not* stand up: a live streamed connection (`dial()` +
 * the full mutual-auth handshake) or a pty/exec stream handler, so the
 * app never sees `connected` for this peer, and no remote session can
 * actually run on it. That gap is exactly the one `machines.test.ts`'s
 * closing comment already names as out of reach without a materially
 * bigger fixture.
 */

/** The *peer's* own beam dir — the far side of the pairing, not the
 *  app's. It deliberately sits outside the fixture HOME rather than
 *  under it: the fixture HOME is the app's `$BEAM_DIR`, and a second
 *  node's identity and peer table have no business inside it. The
 *  directory is empty of anything durable (this side's peer table is
 *  written and thrown away) and `PeerHost.close()` removes it. */
const beamDirFor = (label: string): string =>
  mkdtempSync(join(tmpdir(), `n10-e2e-peer-${label}-`));

const peerPhrase = (label: string): string => `n10-e2e-peer:${label}`;

/** The `peerId` `startPeerHost(label)` will advertise — derived, like
 *  the keypair it comes from, from the label alone, so a test can
 *  assert the fingerprint a pairing dialog shows. */
export function peerHostPeerId(label: string): string {
  return derivePeerId(deterministicKeypair(peerPhrase(label)).publicKeyPem);
}

/** What that `peerId` renders as in the UI's grouped form. */
export function peerHostFingerprint(label: string): string {
  return fingerprint(peerHostPeerId(label));
}

export interface PeerHost {
  identity: Identity;
  /** A fresh, unspent pairing URL — a `PairMachineDialog` paste target. */
  pairingUrl(): string;
  close(): Promise<void>;
}

/** Start a real `Host` on an ephemeral loopback port, advertising itself
 *  at its own bound address. Its `PeerTable` is empty and thrown away —
 *  this side never needs to recognise the app back, only answer its
 *  descriptor and `/pair` requests.
 *
 *  The keypair comes from the label rather than from
 *  `generateKeyPairSync`, so the fingerprint the pairing dialog shows
 *  (and that a paired row copies) is the same on every run — a
 *  screenshot of the confirm step is only worth taking if the thing it
 *  exists to show holds still. The bound port stays ephemeral and is
 *  masked wherever it is rendered; pinning one would trade a random
 *  pixel for a random "address in use". */
export async function startPeerHost(label: string): Promise<PeerHost> {
  const { publicKeyPem, privateKeyPem } = deterministicKeypair(
    peerPhrase(label)
  );
  const identity: Identity = {
    peerId: derivePeerId(publicKeyPem),
    label,
    publicKeyPem,
    privateKeyPem,
  };
  const beamDir = beamDirFor(label);
  const peers = new PeerTable(beamDir);
  const host = new Host({ identity, peers });
  await host.listen();
  host.setEndpoints([host.baseUrl]);
  return {
    identity,
    pairingUrl: () => host.issuePairingUrl().url,
    close: async () => {
      await host.close();
      rmSync(beamDir, { recursive: true, force: true });
    },
  };
}

/** A peer row this test wants already in the peer table when the app
 *  launches — everything `PeerTable` would have written itself, minus
 *  the parts a screenshot has no honest way to hold still (see
 *  `UNREACHABLE_ENDPOINT` and the omitted `lastSeenAt`/`revokedAt`
 *  below). `publicKeyPem` is never read for these rows: nothing in the
 *  visual suite dials or verifies them, only lists, probes and revokes. */
export interface PeerSeed {
  peerId: string;
  label: string;
  endpoints?: string[];
  revoked?: boolean;
  /** Seeds this many durable outbound envelopes for the row's queue-depth
   *  badge — see `seedOutboundQueue`. */
  queued?: number;
}

/** A loopback port nothing listens on. `fetchDescriptor` against it
 *  fails with an immediate connection refusal rather than a timeout, so
 *  the very first probe `BeamNode`'s constructor fires resolves to
 *  `unreachable` well before any test navigates to the panel — no race
 *  against the 5s probe timeout, no wait beyond the UI's own update. */
export const UNREACHABLE_ENDPOINT = 'http://127.0.0.1:1';

/** Write `peers.json` directly into the isolated HOME's beam dir, before
 *  the app ever starts — `PeerTable.load()` parses it verbatim with no
 *  cross-check against the keys, so a row seeded this way renders and
 *  probes exactly as one `PeerTable` had written. `lastSeenAt` and
 *  `revokedAt` are deliberately left unset: `machine-model.ts`'s
 *  `secondaryText` only falls back to a relative-time string once one
 *  is present, so omitting them keeps "never seen" / "revoked" literal
 *  and stable rather than a clock-dependent "3m ago". */
export function seedPeerTable(homeDir: string, peers: PeerSeed[]): void {
  const dir = beamDirIn(homeDir);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const records: PeerRecord[] = peers.map((p) => ({
    peerId: p.peerId,
    label: p.label,
    publicKeyPem: '-- seeded row, never verified --',
    endpoints: p.endpoints ?? [],
    pairedAt: Date.now(),
    revoked: p.revoked ?? false,
  }));
  writeFileSync(join(dir, 'peers.json'), JSON.stringify(records, null, 2), {
    mode: 0o600,
  });
  for (const p of peers) {
    if (p.queued) seedOutboundQueue(homeDir, p.peerId, p.queued);
  }
}

/** Seed `n` durable outbound envelopes for `peerId`, oldest-first, so
 *  `Mailbox.status()` reports a non-zero `queueDepth` the moment the
 *  app starts — the row's "N waiting" badge (`queueBadgeLabel`) without
 *  ever sending anything over the wire. */
export function seedOutboundQueue(
  homeDir: string,
  peerId: string,
  n: number
): void {
  const dir = join(beamDirIn(homeDir), 'mailbox', 'out', peerId);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (let seq = 1; seq <= n; seq += 1) {
    const envelope: Envelope = {
      id: `visual-seed-${peerId}-${seq}`,
      from: 'local',
      to: peerId,
      seq,
      topic: 'report',
      payload: 'target: tmux:visual-seed\n\nseeded for the visual suite',
      encoding: 'utf8',
      createdAt: Date.now(),
    };
    const name = `${String(seq).padStart(10, '0')}.json`;
    writeFileSync(join(dir, name), JSON.stringify(envelope), { mode: 0o600 });
  }
}
