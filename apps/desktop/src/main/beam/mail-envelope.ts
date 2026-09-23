/**
 * What the mail relay reads from and answers about an envelope: its
 * payload, the message it may type and the sender's grant here.
 */
import type { ControlConnection } from './control.js';

/** beam docs/05's envelope, as a `mail` event carries it. */
export interface Envelope {
  id: string;
  from: string;
  payload: string;
  encoding: 'utf8' | 'base64';
}

/** beam docs/06: a defer's reason is at most 1 KiB. */
const MAX_REASON_BYTES = 1000;

/** Generous enough for the agent reports the relay exists to carry,
 *  small enough that a single envelope cannot paste a novel into a REPL. */
export const MAX_RELAY_MESSAGE_BYTES = 32 * 1024;

/** Strips what a terminal would act on rather than display: the C0
 *  controls other than tab and newline (ESC and everything it can
 *  drive, BEL, backspace), DEL and the C1 range. A carriage return
 *  becomes a newline — `deliverToRunningSession` submits with a
 *  trailing CR of its own, so an embedded one is a submit in the
 *  middle of somebody else's message. */
export function sanitizeRelayMessage(message: string): string {
  return (
    message
      .replace(/\r\n?/g, '\n')
      // eslint-disable-next-line no-control-regex -- matching control characters is the point
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, '')
  );
}

/** The grant this machine gives `peerId` (beam docs/06 `peers`): null
 *  when no row names it, undefined when the daemon could not be asked. */
export async function senderGrant(
  conn: ControlConnection,
  peerId: string
): Promise<string | null | undefined> {
  let cursor: string | undefined;
  try {
    do {
      const page = await conn.request<{
        peers: { peerId: string; grant: string }[];
        next?: string;
      }>('peers', cursor ? { cursor } : {});
      const row = page.peers.find((p) => p.peerId === peerId);
      if (row) return row.grant;
      cursor = page.next;
    } while (cursor);
    return null;
  } catch {
    return undefined;
  }
}

/** base64 payloads are unpadded base64url (beam docs/05). */
export function payloadText(envelope: Envelope): string {
  return envelope.encoding === 'base64'
    ? Buffer.from(envelope.payload, 'base64url').toString('utf8')
    : envelope.payload;
}

export function truncateReason(reason: string): string {
  const bytes = Buffer.from(reason, 'utf8');
  return bytes.length <= MAX_REASON_BYTES
    ? reason
    : bytes.subarray(0, MAX_REASON_BYTES).toString('utf8');
}
