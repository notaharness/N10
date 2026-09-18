/**
 * `beam pair <pair-url> [--label NAME] [--endpoint URL]... [--force]` (D9).
 *
 * The fingerprint is printed from `pair()`'s `onBeforeCommit` — the moment
 * the peer's key is verified but before it is written anywhere, which is
 * what makes it the thing a user actually compares out of band before
 * anything has changed (see docs/beam.md). The key-mismatch gate
 * (`PeerKeyMismatchError`) already refuses a replace before that point when
 * the keys differ and `--force` was not given.
 */

import {
  PeerKeyMismatchError,
  PeerTable,
  loadOrCreateIdentity,
  pair,
} from '@n10/beam';
import { parseArgs } from '../args.js';
import { beamDirFor, inboxSocketPath } from '../context.js';
import { fingerprintFor } from '../fingerprint.js';
import type { Io } from '../io.js';
import { connectToRunningNode, requestOnce } from '../ipc-client.js';
import { UsageError } from '../usage.js';

async function notifyRunningNode(beamDir: string): Promise<void> {
  // Best-effort: pairing itself already succeeded and persisted by the
  // time this runs. A running node picks the new peer up on its own next
  // restart regardless — this just lets it authenticate that peer right
  // away, the same reasoning as the revoke/rename/forget admin ops.
  const socket = await connectToRunningNode(inboxSocketPath(beamDir));
  if (!socket) return;
  await requestOnce(socket, { op: 'reload-peers' }).catch(() => undefined);
  socket.end();
}

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
      onBeforeCommit: (info) => {
        const label = labelOverride ?? info.label;
        io.stdout.write(
          `${label} — fingerprint ${fingerprintFor(info.publicKeyPem)}\n`
        );
      },
    });
    const label = labelOverride
      ? peers.rename(result.peer.peerId, labelOverride).label
      : result.peer.label;
    io.stdout.write(`paired with "${label}" (${result.peer.peerId})\n`);
    await notifyRunningNode(beamDir);
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
