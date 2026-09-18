/**
 * Usage text and the exit-2 error type every command throws for a bad
 * invocation. See docs/beam.md and decisions.md D9 for the command
 * contract this mirrors — do not add or rename a flag here without also
 * updating that contract.
 */

export const COMMANDS = [
  'serve',
  'pair',
  'peers',
  'peer',
  'revoke',
  'status',
  'connect',
  'exec',
  'msg',
] as const;

export type Command = (typeof COMMANDS)[number];

export const USAGE = `beam — pairs machines and carries pty, exec and message streams between them.

Usage: beam <command> [options]

Commands:
  serve [--port N] [--hostname ADDR] [--label NAME] [--no-pair]
      Start a node: accept connections, serve the local inbox socket, drain queued messages.
  pair <pair-url> [--label NAME] [--endpoint URL]... [--force]
      Pair with the machine that printed the URL.
  peers [--json]
      List known peers: label, peer id, state, endpoint, queued.
  peer rename <peer> <label>
  peer forget <peer>
  revoke <peer>
  status [--json]
      This machine's identity, whether a node is running, bind address, peer summary.
  connect <peer> [pty|pty:<program>] [--transport ws|webrtc] [-- argv...]
      stdin/stdout into a pty stream on that machine.
  exec <peer> [--cwd PATH] [--env K=V]... -- argv...
      Run argv there. stdout and stderr stay separate; the remote exit code becomes this one's.
  msg send <peer> [--topic T] [--message TEXT | -] [--json]
      One line out: "delivered to <label>" or the queued notice. Exit 0 for both, 1 for rejected.
  msg listen [<peer>...] [--topic T] [--require-ack]
      One JSON envelope per line, acknowledged as it is printed (or on stdin ack with --require-ack).
  msg queue [<peer>] [--json]
      What is waiting, per peer, oldest first.

<peer> accepts a label or a peerId. Exit codes: 0 success, 1 runtime failure, 2 usage error.
`;

/** Thrown by a command's argument parsing (or by the dispatcher for an
 * unrecognized command). Always maps to exit code 2, never a stack trace —
 * a usage mistake is not a crash. */
export class UsageError extends Error {
  constructor(message: string, readonly usage?: string) {
    super(message);
    this.name = 'UsageError';
  }
}

/** Thrown by a command for an expected, named runtime failure (unknown
 * peer, connection refused, node not running, ...). Always maps to exit
 * code 1, printed as `beam: <message>` with no stack trace. */
export class RuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuntimeError';
  }
}

export function isCommand(value: string): value is Command {
  return (COMMANDS as readonly string[]).includes(value);
}
