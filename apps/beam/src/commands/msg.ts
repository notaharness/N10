/** `beam msg send|listen|queue` (D9) — the small dispatcher over the three
 * `msg` subcommands. */

import type { Io } from '../io.js';
import { UsageError } from '../usage.js';
import { runMsgListen } from './msg-listen.js';
import { runMsgQueue } from './msg-queue.js';
import { runMsgSend } from './msg-send.js';

export async function runMsg(args: string[], io: Io): Promise<number> {
  const [sub, ...rest] = args;
  if (sub === 'send') return runMsgSend(rest, io);
  if (sub === 'listen') return runMsgListen(rest, io);
  if (sub === 'queue') return runMsgQueue(rest, io);
  throw new UsageError(
    'usage: beam msg send <peer> [--topic T] [--message TEXT | -] [--json]\n' +
      '       beam msg listen [<peer>...] [--topic T] [--require-ack]\n' +
      '       beam msg queue [<peer>] [--json]'
  );
}
