/**
 * What a paired peer is entitled to open on this machine.
 *
 * Pairing used to be all or nothing: any peer that completed it could open
 * any stream, so a worker whose only job is to report progress home over
 * `msg` also held `pty` and `exec` on the machine that paired it. A scope
 * set is the bounded authorization field that fixes that — three names,
 * one per stream kind, granted when the pairing token is minted and checked
 * on every `Open`. It is not a permissions system: there are no roles, no
 * wildcards, and no filtering of what an `exec` stream may then run.
 *
 * See docs/beam.md, which is authoritative.
 */

/** The three stream kinds a grant can name, in canonical order — every
 * stored and rendered scope list is sorted into it, so two equal grants
 * always serialize identically. Adding a stream kind means adding it here
 * *and* to `scopeForStream`; a name neither knows is left to the stream
 * registry, which refuses it as unsupported. */
export const STREAM_SCOPES = ['pty', 'exec', 'msg'] as const;

export type StreamScope = (typeof STREAM_SCOPES)[number];

export function isStreamScope(value: unknown): value is StreamScope {
  return (STREAM_SCOPES as readonly unknown[]).includes(value);
}

/**
 * The scope a stream name needs, or `undefined` for a name no scope
 * governs. `pty:<program>` is `pty` — the suffix picks the program, not a
 * different kind of access — which is why this splits at the first colon
 * rather than matching the whole name, exactly as `StreamRegistry.resolve`
 * does when it looks the handler up.
 */
export function scopeForStream(name: string): StreamScope | undefined {
  const colon = name.indexOf(':');
  const kind = colon > 0 ? name.slice(0, colon) : name;
  return isStreamScope(kind) ? kind : undefined;
}

/**
 * Read a stored `scopes` value without trusting it. `PeerTable.load` is a
 * bare `JSON.parse` with no validation, so this field arrives as `unknown`
 * however it is typed.
 *
 * - Absent (`undefined`, or the key missing) is the legacy record and every
 *   record written before this field existed: unconstrained, reported here
 *   as `undefined` so a caller can tell "no grant was ever expressed" from
 *   "a grant was expressed and it is empty".
 * - An array keeps the names this version knows and drops the rest, so a
 *   grant written by a newer beam narrows here rather than failing open.
 * - Anything else present — a string, a number, `null` — grants nothing.
 *   A `scopes` field only exists because somebody wrote one, and a value
 *   that cannot be read is not a reason to hand over a shell. The peer then
 *   gets the same clear per-stream refusal as any other narrowed peer,
 *   which is loud, rather than silent unconstrained access.
 */
export function normalizeScopes(
  value: unknown
): readonly StreamScope[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return [];
  return STREAM_SCOPES.filter((scope) => value.includes(scope));
}

/** Apply the table above to a value that claims to be a grant: absent
 * means all three, anything present and unreadable means none. Also how a
 * pair response's `grantedScopes` is read, since a host too old to report
 * one in fact grants everything. */
export function reportedGrant(value: unknown): readonly StreamScope[] {
  return normalizeScopes(value) ?? STREAM_SCOPES;
}

/** What a peer record actually grants, with the legacy default applied:
 * an absent field means all three. A record that is missing entirely
 * grants nothing — the peer was forgotten between opening the connection
 * and opening this stream, and a record that no longer exists cannot be
 * entitling anyone. */
export function grantedScopes(
  record: { scopes?: unknown } | undefined
): readonly StreamScope[] {
  if (!record) return [];
  return reportedGrant(record.scopes);
}

/** The scope `name` needs and `granted` does not hold, or `undefined` when
 * the stream may be opened — either because the grant covers it or because
 * no scope governs that name, which leaves it to the stream registry to
 * refuse as unsupported. */
export function missingScope(
  name: string,
  granted: readonly StreamScope[]
): StreamScope | undefined {
  const required = scopeForStream(name);
  return required && !granted.includes(required) ? required : undefined;
}

/**
 * Combine the grant a peer record already carries with the one a fresh
 * pairing brings, for storage. **The result can only ever be narrower.**
 *
 * Re-pairing is reachable by anyone who holds a live pairing token and the
 * peer's public key — a public key is not a secret, and `replace` is a flag
 * the *caller* sets. If a re-pair could widen a grant, a captured pairing
 * URL would be an escalation path for a peer that had deliberately been
 * held down to `msg`. Narrowing only means the worst a re-pair can do is
 * take access away, which no attacker wants and which the operator can
 * undo. Widening is a local act on the granting machine: forget the peer,
 * then pair it again.
 *
 * Returns `undefined` when neither side expressed a grant, so a peers.json
 * full of unconstrained records does not grow a field it does not need.
 */
export function narrowScopes(
  existing: unknown,
  incoming: unknown
): StreamScope[] | undefined {
  const held = normalizeScopes(existing);
  const offered = normalizeScopes(incoming);
  if (held === undefined && offered === undefined) return undefined;
  if (held === undefined) return [...(offered as readonly StreamScope[])];
  if (offered === undefined) return [...held];
  return STREAM_SCOPES.filter(
    (scope) => held.includes(scope) && offered.includes(scope)
  );
}

/**
 * The close reason a host sends when a peer opens a stream it was not
 * granted, and the error the opener's `openStream` rejects with.
 *
 * Machine-readable on the wire for the same reason the HTTP surface answers
 * `{"error":"revoked-peer"}` rather than prose: the far side has to be able
 * to tell this apart from every other way a stream can fail to open, and a
 * refusal that a caller mistakes for a broken host is a refusal that gets
 * retried forever. `Muxer` turns it back into a named error at the opener,
 * so nothing above has to match on strings.
 */
export const SCOPE_REFUSAL_PREFIX = 'scope-not-granted:';

export function scopeRefusalReason(scope: StreamScope): string {
  return `${SCOPE_REFUSAL_PREFIX}${scope}`;
}

/** The scope named by a refusal close reason, or `undefined` for any other
 * close — an ordinary end of stream, a transport that died, a handler that
 * threw. None of those can be confused for this one. */
export function parseScopeRefusal(
  reason: string | undefined
): StreamScope | undefined {
  if (reason === undefined || !reason.startsWith(SCOPE_REFUSAL_PREFIX))
    return undefined;
  const scope = reason.slice(SCOPE_REFUSAL_PREFIX.length);
  return isStreamScope(scope) ? scope : undefined;
}

/**
 * Thrown (as a rejection of `openStream`, or handed to `onClose`) when the
 * far machine refused the stream because this machine is not granted that
 * scope there.
 *
 * Distinguishable on purpose, and distinguishable from a transport failure
 * in particular: "you may not do this here" is permanent until somebody
 * re-pairs, while "the connection died" is worth retrying. A caller that
 * cannot tell them apart either retries an answer that will never change
 * or gives up on a host that is merely unreachable.
 */
/** The error a `Close` on a stream that never opened becomes: a named
 * `StreamScopeError` when the far side refused it for want of a scope, an
 * ordinary `Error` for every other way a stream can die. */
export function streamCloseError(
  reason: string | undefined,
  streamName: string
): Error {
  const refused = parseScopeRefusal(reason);
  return refused
    ? new StreamScopeError(refused, streamName)
    : new Error(reason ?? 'stream was closed before it opened');
}

export class StreamScopeError extends Error {
  constructor(readonly scope: StreamScope, readonly streamName: string) {
    super(
      `the peer did not grant '${scope}' to this machine, so it refused the '${streamName}' stream`
    );
    this.name = 'StreamScopeError';
  }
}
