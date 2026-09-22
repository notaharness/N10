/** The local IPC socket's wire form: one JSON value per line. Shared by
 * `ipc-socket.ts` and the peer-admin ops it dispatches to. */

import type { Socket } from 'node:net';

export function writeLine(socket: Socket, value: unknown): void {
  if (socket.writable) socket.write(`${JSON.stringify(value)}\n`);
}
