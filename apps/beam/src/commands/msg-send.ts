/**
 * `beam msg send <peer> [--topic T] [--message TEXT | -] [--json]` (D9/D11).
 *
 * The peer name is handed to the mailbox unresolved — `Mailbox.send()`
 * (or the running node's own copy of it, over the socket) owns unknown/
 * revoked/oversized rejection, so both the running-node and ephemeral
 * paths produce identically-shaped outcomes and the exact D11 rejection
 * causes, rather than this command pre-empting them with its own check.
 */

import type { SendOutcome } from '@n10/beam';
import { parseArgs } from '../args.js';
import { beamDirFor, inboxSocketPath } from '../context.js';
import { dialPeer } from '../dial-peer.js';
import { printJson } from '../fmt/json.js';
import type { Io } from '../io.js';
import { connectToRunningNode, requestOnce } from '../ipc-client.js';
import { buildEphemeral, ephemeralMailbox } from '../node.js';
import { readAllStdin } from '../stdin.js';
import { UsageError } from '../usage.js';

type WireOutcome = { status: SendOutcome['outcome'] } & Record<string, unknown>;

function toWireOutcome(outcome: SendOutcome): WireOutcome {
  const { outcome: status, ...rest } = outcome;
  return { status, ...rest };
}

function describeRejection(reason: unknown): string {
  switch (reason) {
    case 'unknown-peer':
      return 'unknown peer — check the label or peer id with "beam peers"';
    case 'revoked-peer':
      return 'that peer has been revoked and can no longer receive messages';
    case 'oversized-payload':
      return 'message exceeds the 256 KiB cap';
    default:
      return String(reason);
  }
}

function describeQueued(label: string, reason: unknown): string {
  if (typeof reason === 'string' && reason.startsWith('no ack')) {
    return (
      `queued for ${label} — beam is still trying to deliver it over the connection ` +
      `that is up right now. Either way it is durably queued. Do not send it again.`
    );
  }
  return (
    `queued for ${label} — that machine is not connected right now. beam will deliver this\n` +
    `message the next time it comes online. Do not send it again.`
  );
}

interface SendRequest {
  to: string;
  topic: string;
  payload: string;
}

/** Try a live connection first when there is one worth trying, then always
 * fall through to `mailbox.send()` — a failed dial just means `queued` is
 * the honest outcome, not an error to raise. */
async function sendViaEphemeralNode(
  io: Io,
  request: SendRequest
): Promise<WireOutcome> {
  const ctx = buildEphemeral(io);
  const peer = ctx.peers.resolve(request.to);
  const attemptedDial =
    Boolean(peer) &&
    peer?.revoked === false &&
    (peer?.endpoints.length ?? 0) > 0;
  if (attemptedDial && peer) {
    await dialPeer(ctx, peer).catch(() => undefined);
  }
  // Nothing to wait out when delivery was never even attempted (unknown,
  // revoked, or no known endpoint) — a peer we did dial still gets the
  // mailbox's usual window to actually receive its ack.
  const mailbox = ephemeralMailbox(
    ctx,
    attemptedDial ? {} : { sendAwaitMs: 50 }
  );
  const raw = await mailbox.send({ ...request, encoding: 'utf8' });
  mailbox.dispose();
  return toWireOutcome(raw);
}

async function resolveSendOutcome(
  io: Io,
  request: SendRequest
): Promise<WireOutcome> {
  const socket = await connectToRunningNode(inboxSocketPath(beamDirFor(io)));
  if (!socket) return sendViaEphemeralNode(io, request);
  const response = await requestOnce(socket, {
    op: 'send',
    ...request,
    encoding: 'utf8',
  });
  socket.end();
  return response as WireOutcome;
}

export async function runMsgSend(args: string[], io: Io): Promise<number> {
  const parsed = parseArgs(args, {
    valueFlags: ['topic', 'message'],
    booleanFlags: ['json'],
  });
  const [nameOrId] = parsed.positionals;
  if (!nameOrId) {
    throw new UsageError(
      'usage: beam msg send <peer> [--topic T] [--message TEXT | -] [--json]'
    );
  }
  const topic = parsed.values.get('topic') ?? '';
  const messageFlag = parsed.values.get('message');
  if (messageFlag === undefined && io.stdin.isTTY) {
    // No --message and an interactive terminal attached: reading stdin
    // would block forever waiting for an EOF that will never come. Refuse
    // up front rather than hanging — a usage mistake, not a runtime one.
    throw new UsageError(
      'usage: beam msg send <peer> [--topic T] [--message TEXT | -] [--json]\n' +
        'refusing to wait on an interactive stdin with no --message — pass one, or pipe input.'
    );
  }
  const payload =
    messageFlag !== undefined && messageFlag !== '-'
      ? messageFlag
      : await readAllStdin(io.stdin);

  const outcome = await resolveSendOutcome(io, {
    to: nameOrId,
    topic,
    payload,
  });

  if (parsed.booleans.has('json')) {
    printJson(io.stdout, outcome);
    return outcome.status === 'rejected' ? 1 : 0;
  }

  if (outcome.status === 'delivered') {
    io.stdout.write(`delivered to ${String(outcome['label'])}\n`);
    return 0;
  }
  if (outcome.status === 'queued') {
    io.stdout.write(
      `${describeQueued(String(outcome['label']), outcome['reason'])}\n`
    );
    return 0;
  }
  io.stderr.write(`could not send: ${describeRejection(outcome['reason'])}\n`);
  return 1;
}
