/**
 * The single entry point every command goes through: `run(argv, io)`.
 * `main.ts` is a thin wrapper over this — tests call it directly with a
 * fake `io` instead of spawning a process.
 */

import type { Io } from './io.js';
import {
  COMMANDS,
  RuntimeError,
  USAGE,
  UsageError,
  isCommand,
  type Command,
} from './usage.js';
import { runConnect } from './commands/connect.js';
import { runExec } from './commands/exec.js';
import { runMsg } from './commands/msg.js';
import { runPair } from './commands/pair.js';
import { runPeer } from './commands/peer.js';
import { runPeers } from './commands/peers.js';
import { runRevoke } from './commands/revoke.js';
import { runServe } from './commands/serve.js';
import { runStatus } from './commands/status.js';

export async function run(argv: string[], io: Io): Promise<number> {
  const [command, ...rest] = argv;

  if (!command) {
    io.stderr.write(USAGE);
    return 2;
  }
  if (command === '--help' || command === '-h') {
    io.stdout.write(USAGE);
    return 0;
  }
  if (!isCommand(command)) {
    io.stderr.write(
      `beam: unknown command "${command}"\nValid commands: ${COMMANDS.join(
        ', '
      )}\n`
    );
    return 2;
  }
  // `--help`/`-h` on a subcommand (including a two-word one like `msg
  // send`) should work like the top-level one, not fall through into that
  // command's own flag parsing — which either rejects it as an
  // unrecognized option, or, worse, treats a short `-h` it does not
  // recognize as a positional (a peer name) and blocks on stdin. Scanned
  // only up to the first literal `--`, so a "--help" a command legitimately
  // passes on to the far side (e.g. `beam exec peer -- ls --help`) is never
  // mistaken for beam's own.
  if (wantsHelp(rest)) {
    io.stdout.write(USAGE);
    return 0;
  }

  try {
    return await dispatch(command, rest, io);
  } catch (error) {
    if (error instanceof UsageError) {
      io.stderr.write(`beam: ${error.message}\n`);
      if (error.usage) io.stderr.write(`${error.usage}\n`);
      return 2;
    }
    if (error instanceof RuntimeError) {
      io.stderr.write(`beam: ${error.message}\n`);
      return 1;
    }
    io.stderr.write(`beam: ${(error as Error).message}\n`);
    return 1;
  }
}

function wantsHelp(rest: string[]): boolean {
  for (const token of rest) {
    if (token === '--') return false;
    if (token === '--help' || token === '-h') return true;
  }
  return false;
}

function dispatch(command: Command, rest: string[], io: Io): Promise<number> {
  switch (command) {
    case 'serve':
      return runServe(rest, io);
    case 'pair':
      return runPair(rest, io);
    case 'peers':
      return runPeers(rest, io);
    case 'peer':
      return runPeer(rest, io);
    case 'revoke':
      return runRevoke(rest, io);
    case 'status':
      return runStatus(rest, io);
    case 'connect':
      return runConnect(rest, io);
    case 'exec':
      return runExec(rest, io);
    case 'msg':
      return runMsg(rest, io);
  }
}
