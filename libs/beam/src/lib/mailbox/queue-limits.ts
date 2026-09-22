/**
 * Per-peer bounds on the durable queues, so a peer that is offline for a
 * week — or one sending faster than it can be drained — cannot fill the
 * disk this node's own mail also lives on. Shared by the outbound queue
 * and the inbound store, which face the same growth from opposite
 * directions. Passing either bound is a `rejected` outcome (outbound) or a
 * refused envelope (inbound), never a silent overwrite or an unbounded
 * directory.
 */

import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface QueueLimits {
  /** Most envelopes one peer may have waiting. */
  maxDepth: number;
  /** Most bytes one peer's waiting envelopes may occupy. */
  maxBytes: number;
}

export const DEFAULT_QUEUE_LIMITS: QueueLimits = {
  maxDepth: 10_000,
  maxBytes: 64 * 1024 * 1024,
};

export function resolveQueueLimits(
  limits: Partial<QueueLimits> = {}
): QueueLimits {
  return { ...DEFAULT_QUEUE_LIMITS, ...limits };
}

/** How much one peer's queue directory is currently holding. Counts and
 * sizes the files rather than parsing them: a file that disappears under
 * the scan (a concurrent drain) simply is not counted. */
export function directoryUsage(dir: string): { count: number; bytes: number } {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return { count: 0, bytes: 0 };
  }
  let count = 0;
  let bytes = 0;
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    count += 1;
    try {
      bytes += statSync(join(dir, name)).size;
    } catch {
      // Removed while we were looking; it is not holding anything.
    }
  }
  return { count, bytes };
}

export function isAtLimit(dir: string, limits: QueueLimits): boolean {
  const { count, bytes } = directoryUsage(dir);
  return count >= limits.maxDepth || bytes >= limits.maxBytes;
}
