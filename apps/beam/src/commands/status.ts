/**
 * `beam status [--json]` — D9: "This machine's peerId and label, whether a
 * node is running, bind address, peer summary."
 *
 * The local IPC `status` op (docs/beam.md) returns only `{ peers }`, not a
 * bind address, so a running node's address comes from the small
 * `run/host.json` sidecar `serve` writes (see context.ts) — best-effort;
 * its absence just means the address is not shown, never a hard failure.
 */

import { loadOrCreateIdentity, type PeerState } from '@n10/beam';
import { parseArgs } from '../args.js';
import { beamDirFor } from '../context.js';
import { printJson } from '../fmt/json.js';
import type { Io } from '../io.js';
import { readHostInfo } from '../node.js';
import { collectPeerRows } from './peer-status.js';

function summarize(rows: { state: PeerState; queueDepth: number }[]) {
  const connected = rows.filter((r) => r.state === 'connected').length;
  const queueDepth = rows.reduce((sum, r) => sum + r.queueDepth, 0);
  return { total: rows.length, connected, queueDepth };
}

export async function runStatus(args: string[], io: Io): Promise<number> {
  const parsed = parseArgs(args, { booleanFlags: ['json'] });
  const beamDir = beamDirFor(io);
  const identity = loadOrCreateIdentity(beamDir);
  const { rows, nodeRunning } = await collectPeerRows(io);
  const hostInfo = nodeRunning ? readHostInfo(beamDir) : null;
  const bindAddress = hostInfo ? `${hostInfo.hostname}:${hostInfo.port}` : null;
  const peers = summarize(rows);

  if (parsed.booleans.has('json')) {
    printJson(io.stdout, {
      peerId: identity.peerId,
      label: identity.label,
      running: nodeRunning,
      bindAddress,
      peers,
    });
    return 0;
  }

  const lines = [
    `label:      ${identity.label}`,
    `peer id:    ${identity.peerId}`,
    `node:       ${nodeRunning ? 'running' : 'not running'}${
      nodeRunning && !bindAddress ? ' (bind address unknown)' : ''
    }`,
  ];
  if (bindAddress) lines.push(`bound to:   ${bindAddress}`);
  lines.push(
    `peers:      ${peers.total} known, ${peers.connected} connected, ${peers.queueDepth} message(s) queued`
  );
  io.stdout.write(`${lines.join('\n')}\n`);
  return 0;
}
