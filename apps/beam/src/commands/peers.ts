/**
 * `beam peers [--json]` — D9/D6/D7: LABEL, PEER ID, STATE, ENDPOINT, QUEUED.
 */

import { parseArgs } from '../args.js';
import { printJson } from '../fmt/json.js';
import { renderTable } from '../fmt/table.js';
import type { Io } from '../io.js';
import { collectPeerRows, describeState } from './peer-status.js';

export async function runPeers(args: string[], io: Io): Promise<number> {
  const parsed = parseArgs(args, { booleanFlags: ['json'] });
  const { rows } = await collectPeerRows(io);

  if (parsed.booleans.has('json')) {
    printJson(io.stdout, rows);
    return 0;
  }

  if (rows.length === 0) {
    io.stdout.write('No paired peers. Run "beam pair <url>" to add one.\n');
    return 0;
  }

  const table = rows.map((row) => [
    row.label,
    row.peerId,
    describeState(row.state) + (row.revoked ? ' (revoked)' : ''),
    row.endpoint,
    row.queueDepth > 0 ? String(row.queueDepth) : '',
  ]);
  io.stdout.write(
    renderTable(['LABEL', 'PEER ID', 'STATE', 'ENDPOINT', 'QUEUED'], table)
  );
  return 0;
}
