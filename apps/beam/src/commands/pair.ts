/**
 * `beam pair <pair-url> [--label NAME] [--endpoint URL]... [--force]` (D9).
 *
 * The fingerprint is printed the moment the peer's key is known — the
 * earliest point reachable through the library's exported `pair()`, whose
 * own key-mismatch gate (`PeerKeyMismatchError`) already refuses a replace
 * *before* writing anything when the keys differ and `--force` was not
 * given, which is the case that actually matters here (see docs/beam.md).
 */

import {
  PeerKeyMismatchError,
  PeerTable,
  loadOrCreateIdentity,
  pair,
} from '@n10/beam';
import { parseArgs } from '../args.js';
import { beamDirFor } from '../context.js';
import { fingerprintFor } from '../fingerprint.js';
import type { Io } from '../io.js';
import { UsageError } from '../usage.js';

export async function runPair(args: string[], io: Io): Promise<number> {
  const parsed = parseArgs(args, {
    valueFlags: ['label'],
    multiFlags: ['endpoint'],
    booleanFlags: ['force'],
  });
  const [pairUrl] = parsed.positionals;
  if (!pairUrl) {
    throw new UsageError(
      'usage: beam pair <pair-url> [--label NAME] [--endpoint URL]... [--force]'
    );
  }

  const beamDir = beamDirFor(io);
  const identity = loadOrCreateIdentity(beamDir);
  const peers = new PeerTable(beamDir);
  const labelOverride = parsed.values.get('label');

  try {
    const result = await pair(pairUrl, peers, {
      identity,
      endpoints: parsed.multi.get('endpoint') ?? [],
      force: parsed.booleans.has('force'),
    });
    const label = labelOverride
      ? peers.rename(result.peer.peerId, labelOverride).label
      : result.peer.label;
    io.stdout.write(
      `${label} — fingerprint ${fingerprintFor(result.peer.publicKeyPem)}\n`
    );
    io.stdout.write(`paired with "${label}" (${result.peer.peerId})\n`);
    return 0;
  } catch (error) {
    if (error instanceof PeerKeyMismatchError) {
      io.stderr.write(
        `refusing to pair: peer ${error.peerId} is already known here as ` +
          `"${error.existingLabel}", but presented a different key this time.\n` +
          `This means either "${error.existingLabel}" was reinstalled (a fresh ` +
          `identity) or something is presenting an impostor key. Compare the ` +
          `fingerprint with "${error.existingLabel}" out of band, then re-run ` +
          `with --force to accept the replacement.\n`
      );
      return 1;
    }
    throw error;
  }
}
