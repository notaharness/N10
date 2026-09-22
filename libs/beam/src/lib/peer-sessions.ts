/**
 * Per-peer bookkeeping for the live child processes a stream handler owns.
 *
 * One handler instance is shared by every connection on a node (host.ts
 * hands every connection the same StreamRegistry), so the map has to key on
 * `(peerId, streamId)` and never on a bare stream id: ids are unique only
 * within one connection, and two peers can each open id 1 at the same
 * moment. That same key is what lets the limit be per peer rather than
 * global — one peer opening its full allowance must not shrink another's
 * (D5).
 */

import type { BeamStream } from './stream.js';

export class PeerSessions<T> {
  private readonly sessions = new Map<string, T>();

  constructor(private readonly limit: number) {}

  key(stream: BeamStream): string {
    return `${stream.peer.peerId}:${stream.id}`;
  }

  /** Whether this peer already holds its full allowance. */
  atLimit(peerId: string): boolean {
    const prefix = `${peerId}:`;
    let count = 0;
    for (const key of this.sessions.keys()) {
      if (key.startsWith(prefix)) count += 1;
    }
    return count >= this.limit;
  }

  add(key: string, session: T): void {
    this.sessions.set(key, session);
  }

  /** Whether `key` still holds exactly `session` — the guard every teardown
   * path needs, so a late event from a replaced session cannot reach in and
   * remove its successor. */
  holds(key: string, session: T): boolean {
    return this.sessions.get(key) === session;
  }

  /** Drop `key`, but only while it still holds `session`. Returns whether
   * it did, so a caller can make this its "am I the one tearing down"
   * check in the same step. */
  release(key: string, session: T): boolean {
    if (!this.holds(key, session)) return false;
    this.sessions.delete(key);
    return true;
  }
}
