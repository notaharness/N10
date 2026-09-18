/**
 * Wraps a worker-local pty stream id with the worker generation that
 * minted it. `RemoteOps.nextStreamId` (`beam-node-remote-ops.ts`)
 * restarts at 1 inside every fresh worker process, so the raw id alone
 * cannot tell a handle opened on a dead worker from a same-named
 * stream on its replacement — that collision is what let a stale
 * handle write into, and receive from, whatever session the new
 * worker happened to open first. Prefixing with the generation makes
 * a stale handle's id permanently distinguishable, so a caller can
 * refuse it outright instead of guessing.
 */

export interface ParsedStreamId {
  generation: number;
  rawId: string;
}

export function wrapStreamId(generation: number, rawId: string): string {
  return `${generation}:${rawId}`;
}

/** `null` for anything that is not a well-formed wrapped id — a
 *  caller should treat that the same as a generation mismatch. */
export function parseStreamId(streamId: string): ParsedStreamId | null {
  const sep = streamId.indexOf(':');
  if (sep === -1) return null;
  const generation = Number(streamId.slice(0, sep));
  if (!Number.isInteger(generation)) return null;
  return { generation, rawId: streamId.slice(sep + 1) };
}
