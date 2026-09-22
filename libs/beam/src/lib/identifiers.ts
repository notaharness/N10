/**
 * Shape rules for the three strings that arrive from outside this machine
 * and then become filesystem path segments, or get interpolated into
 * output other tools parse: `peerId`, `label` and `topic`. Only `peerId`
 * reaches a path; `label` and `topic` reach logs, terminals and the JSON
 * lines other tools parse.
 *
 * `peerId` is derived from a public key and is always 16 lowercase hex
 * characters, so anything else is either corruption or an attempt to steer
 * a path — `mailbox/out/<peerId>/`, `mailbox/in/<peerId>/` and
 * `mailbox/seen/<peerId>.json` all `join` it directly. Nothing traversable
 * is reachable today precisely because every such segment is a derived id;
 * the check is what keeps that true when a later caller passes something
 * else.
 *
 * `label` and `topic` are chosen by a person or by the peer, and are
 * rejected rather than sanitised: a label silently rewritten no longer
 * matches what the user was shown for the out-of-band fingerprint
 * comparison that pairing depends on.
 */

/** Exactly what `derivePeerId` produces. */
export const PEER_ID_PATTERN = /^[0-9a-f]{16}$/;

export const MAX_LABEL_LENGTH = 64;
export const MAX_TOPIC_LENGTH = 128;

/** Path separators, the brace characters that would confuse a template or
 * a tmux target, and every C0/C1 control character — a label or topic ends
 * up in logs, in the JSON lines other tools parse, and on a terminal. */
// eslint-disable-next-line no-control-regex -- matching control characters is the point of this pattern: a label or topic carrying one reaches logs, the JSON lines other tools parse, and a terminal's escape handling.
const FORBIDDEN = /[\u0000-\u001f\u007f-\u009f/\\{}]/;

export function isPeerId(value: unknown): value is string {
  return typeof value === 'string' && PEER_ID_PATTERN.test(value);
}

export function assertPeerId(value: string, what = 'peerId'): string {
  if (!isPeerId(value)) {
    throw new Error(
      `${what} must be 16 lowercase hex characters, got ${JSON.stringify(
        value
      )}`
    );
  }
  return value;
}

export function isLabel(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_LABEL_LENGTH &&
    value.trim() === value &&
    !FORBIDDEN.test(value)
  );
}

export function assertLabel(value: string): string {
  if (!isLabel(value)) {
    throw new Error(
      `label must be 1-${MAX_LABEL_LENGTH} characters with no path separators, braces or control characters`
    );
  }
  return value;
}

/** The empty topic is the documented default of the optional `--topic`
 * flag and means "no topic" — the same thing `msg listen` means by an
 * absent `--topic`, namely no filter. A topic is never a path segment, so
 * the character and length checks are the whole guard. */
export function isTopic(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= MAX_TOPIC_LENGTH &&
    !FORBIDDEN.test(value)
  );
}
