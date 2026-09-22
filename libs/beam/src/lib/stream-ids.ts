/**
 * Stream id allocation for one connection.
 *
 * Either side may open a stream, so ids are partitioned by role
 * (docs/beam.md): the side that dialled allocates odd ids, the side that
 * accepted even ones, and id 0 is the connection's own control channel
 * rather than a stream. The partition is what keeps two simultaneous opens
 * from landing on the same id, so both halves of it are enforced — what
 * this side hands out, and what it accepts from the peer.
 */

import { MAX_STREAM_ID } from './protocol.js';
import type { MuxerRole } from './muxer-role.js';

export class StreamIdAllocator {
  /** 1 when this side allocates odd ids (it dialled), 0 when it allocates
   * even ones (it accepted). */
  private readonly ownParity: number;
  private next: number;

  constructor(role: MuxerRole) {
    this.ownParity = role === 'initiator' ? 1 : 0;
    this.next = role === 'initiator' ? 1 : 2;
  }

  /**
   * The next free id in this side's parity space. `isLive` skips ids still
   * in use: a bare counter is not enough, because an id can still be
   * occupied when the counter wraps back onto it, and the caller's map
   * entry for the live stream would then be overwritten — detaching that
   * stream from every frame that followed, with nothing to say so.
   *
   * Throws once the space is exhausted rather than handing out an id the
   * wire's 16-bit field cannot carry.
   */
  allocate(isLive: (streamId: number) => boolean): number {
    let id = this.next;
    while (isLive(id)) id += 2;
    if (id > MAX_STREAM_ID) {
      throw new RangeError(
        `this connection has no stream ids left (the wire maximum is ${MAX_STREAM_ID})`
      );
    }
    this.next = id + 2;
    return id;
  }

  /** Whether `streamId` is the peer's to open. An inbound Open inside this
   * side's own parity space is refused: honouring it would either displace
   * a stream already held or collide with one about to be allocated, which
   * is exactly what the partition exists to prevent. */
  belongsToPeer(streamId: number): boolean {
    if (streamId === 0) return false;
    return streamId % 2 !== this.ownParity;
  }
}
