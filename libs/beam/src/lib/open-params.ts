/**
 * Small shared guards for reading a stream's JSON open parameters
 * (docs/beam.md's `pty`/`exec` open payloads), used by both handlers.
 */

export function isString(value: unknown): value is string {
  return typeof value === 'string';
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString);
}

export function isStringRecord(
  value: unknown
): value is Record<string, string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every(isString)
  );
}

/** Decode an Open frame's payload per D1: a `{`-prefixed payload is a JSON
 * object whose `name` is the stream name and whose other fields are its open
 * parameters, in one frame; anything else (including malformed JSON, or JSON
 * without a string `name`) is the bare stream name, unparsed — the host-poc
 * form, which stays valid. */
export function parseOpenPayload(text: string): {
  name: string;
  params?: Record<string, unknown>;
} {
  if (!text.startsWith('{')) return { name: text };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { name: text };
  }
  if (typeof parsed !== 'object' || parsed === null) return { name: text };
  const { name, ...params } = parsed as Record<string, unknown>;
  if (typeof name !== 'string') return { name: text };
  return { name, params };
}
