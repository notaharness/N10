/**
 * `beam msg queue [<peer>] [--json]` (D9): what is waiting, per peer,
 * oldest first. Reads the outbound queue directly off disk — the same
 * files whether or not a node happens to be running right now, and the
 * local IPC protocol has no `queue` op to go through anyway.
 *
 * Also surfaces quarantined (unrecoverable) messages: docs/beam.md is
 * explicit that a lost message must stay loud, never silent, and this
 * listing is one of the places it names.
 */

import { OutboundQueue, PeerTable } from '@n10/beam';
import { parseArgs } from '../args.js';
import { beamDirFor } from '../context.js';
import { printJson } from '../fmt/json.js';
import { renderTable } from '../fmt/table.js';
import type { Io } from '../io.js';
import { resolvePeer } from '../peer-resolve.js';

export async function runMsgQueue(args: string[], io: Io): Promise<number> {
  const parsed = parseArgs(args, { booleanFlags: ['json'] });
  const beamDir = beamDirFor(io);
  const peers = new PeerTable(beamDir);
  const queue = new OutboundQueue(beamDir);

  const [nameOrId] = parsed.positionals;
  const peerIds = nameOrId
    ? [resolvePeer(peers, nameOrId).peerId]
    : queue.peerIds();

  const labelFor = (peerId: string): string =>
    peers.get(peerId)?.label ?? peerId;

  const queued = peerIds.flatMap((peerId) =>
    queue.list(peerId).map(({ envelope }) => ({
      peerId,
      label: labelFor(peerId),
      id: envelope.id,
      topic: envelope.topic,
      seq: envelope.seq,
      createdAt: new Date(envelope.createdAt).toISOString(),
      bytes: Buffer.byteLength(
        envelope.payload,
        envelope.encoding === 'base64' ? 'base64' : 'utf8'
      ),
    }))
  );
  const lost = peerIds.flatMap((peerId) =>
    queue.quarantined(peerId).map((q) => ({ ...q, label: labelFor(peerId) }))
  );

  if (parsed.booleans.has('json')) {
    printJson(io.stdout, { queued, lost });
    return 0;
  }

  if (queued.length === 0 && lost.length === 0) {
    io.stdout.write('Nothing queued.\n');
    return 0;
  }
  if (queued.length > 0) {
    io.stdout.write(
      renderTable(
        ['PEER', 'TOPIC', 'QUEUED AT', 'BYTES', 'ID'],
        queued.map((q) => [
          q.label,
          q.topic,
          q.createdAt,
          String(q.bytes),
          q.id,
        ])
      )
    );
  }
  if (lost.length > 0) {
    io.stdout.write(
      `\n${lost.length} message(s) LOST — quarantined, unrecoverable, and were already reported delivered as "queued":\n`
    );
    for (const item of lost) {
      io.stdout.write(`  ${item.label}/${item.fileName}: ${item.reason}\n`);
    }
  }
  return 0;
}
