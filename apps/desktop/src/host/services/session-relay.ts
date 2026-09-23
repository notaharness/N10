import { getSession, hasPersistedTerminalSession } from '@n10/core';
import type { SessionBuffer } from '../contract.js';

/**
 * The output relay every host-launched session hangs off: a bounded
 * ring buffer of recent chunks for terminals that mount late, and a
 * push of each live chunk to the renderer windows.
 *
 * Shared by worktree sessions (`sessions.ts`) and terminal tabs
 * (`terminals.ts`), which keep different books about *what* a session
 * is but need the same thing done with its bytes.
 */

/** Per-session scrollback kept for late/remounting terminals. */
const BUFFER_LIMIT = 512 * 1024;

let broadcast: ((channel: string, payload: unknown) => void) | null = null;

/** Called from main.ts once windows exist; forwards PTY output and
 *  exit notices to every renderer window. */
export function setSessionBroadcaster(
  fn: (channel: string, payload: unknown) => void
): void {
  broadcast = fn;
}

export interface RelayEntry {
  /** Ring buffer of recent output chunks (bounded by BUFFER_LIMIT). */
  chunks: string[];
  bytes: number;
  /** Monotonic chunk counter. Carried across a respawn under the same
   *  name — a mounted terminal ignores chunks at or below the sequence
   *  its replay ended at, so numbering from 1 again would leave the new
   *  process looking dead in the pane the restart came from. */
  seq: number;
}

export function newRelayEntry(seq = 0): RelayEntry {
  return { chunks: [], bytes: 0, seq };
}

/** Start relaying the registry session under `name` into `entry`.
 *  Throws when the session is not there — the caller just spawned it,
 *  so its absence is a bug, not a state. */
export function attachRelay(name: string, entry: RelayEntry): void {
  const session = getSession(name);
  if (!session) throw new Error(`Session ${name} vanished after spawn`);
  session.pty.onData((data) => {
    entry.seq += 1;
    entry.chunks.push(data);
    entry.bytes += data.length;
    while (entry.bytes > BUFFER_LIMIT && entry.chunks.length > 1) {
      entry.bytes -= entry.chunks.shift()?.length ?? 0;
    }
    broadcast?.('n10/session/data', { name, data, seq: entry.seq });
  });
  session.pty.onExit((code) => {
    // A respawn under the same name — a restart, or a terminal tab
    // reattached after a detach from inside tmux — replaces the entry
    // before the old client's exit lands here. That exit is a client
    // going away, not the session ending, and the renderer closes a
    // terminal tab on this event by name. An entry that is *gone* is
    // different: the terminal host releases a session's tombstone on
    // the exit that precedes this listener, and that end is reported.
    const current = getSession(name);
    if (current && current !== session) return;
    console.log(`[desktop] session ${name} exited with code ${code}`);
    broadcast?.('n10/session/exit', {
      name,
      code,
      retained: !!current && hasPersistedTerminalSession(name),
    });
  });
}

export function relayBuffer(entry: RelayEntry): SessionBuffer {
  return { data: entry.chunks.join(''), seq: entry.seq };
}
