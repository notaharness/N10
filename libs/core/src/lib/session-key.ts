import { basename } from 'node:path';
import type { WorktreeInfo } from '@n10/worktree-manager';
import { getRepoRoot } from './repo-root.js';

/** The machine a session lives on: a beam `peerId`, or `'local'` for
 *  this machine. Not a label — labels are renameable and local to each
 *  side; the UI resolves this id to a label for display. */
export const LOCAL_MACHINE = 'local';

export type SessionIdentity =
  | { kind: 'worktree'; repo: string; branch: string; machine: string }
  | { kind: 'terminal'; id: string; machine: string };

/**
 * Opaque internal keys. JSON tuples keep punctuation and namespaces
 * distinct. The machine is an *optional trailing segment*, omitted
 * entirely when it is `'local'` — every call site that does not pass
 * one keeps producing exactly the key it produces today (decisions.md
 * D2). Do not renumber the tuple; a new dimension is always appended.
 */
export function worktreeSessionKey(
  branch: string,
  repo = getRepoRoot() ?? process.cwd(),
  machine: string = LOCAL_MACHINE
): string {
  return machine === LOCAL_MACHINE
    ? JSON.stringify(['worktree', repo, branch])
    : JSON.stringify(['worktree', repo, branch, machine]);
}

export function terminalSessionKey(
  id: string,
  machine: string = LOCAL_MACHINE
): string {
  return machine === LOCAL_MACHINE
    ? JSON.stringify(['terminal', id])
    : JSON.stringify(['terminal', id, machine]);
}

/**
 * Switches on `value[0]` first, then reads positionally with an
 * optional trailing machine segment — *not* on tuple length and kind
 * together. A remote terminal key (`['terminal', id, machine]`) is
 * length 3, the same length as a local worktree key
 * (`['worktree', repo, branch]`); matching length-and-kind together
 * would make the terminal arm's length-3 check miss it, and the
 * worktree arm's `value[0] === 'worktree'` check also miss it, so the
 * key would silently parse to `null` — a key with no identity, which
 * downstream code reads as "not ours". Reading `value[0]` first avoids
 * the collision entirely: kind decides the shape, length only bounds
 * where the optional machine segment may be.
 */
/** A trailing element that, when present, must be the machine string;
 *  absent reads as local. Shared by both tuple shapes below. */
function trailingMachine(value: unknown[], at: number): string | null {
  if (value.length === at) return LOCAL_MACHINE;
  if (value.length === at + 1 && typeof value[at] === 'string')
    return value[at] as string;
  return null;
}

function parseTerminalIdentity(value: unknown[]): SessionIdentity | null {
  if (typeof value[1] !== 'string') return null;
  const machine = trailingMachine(value, 2);
  return machine === null ? null : { kind: 'terminal', id: value[1], machine };
}

function parseWorktreeIdentity(value: unknown[]): SessionIdentity | null {
  if (typeof value[1] !== 'string' || typeof value[2] !== 'string') return null;
  const machine = trailingMachine(value, 3);
  return machine === null
    ? null
    : { kind: 'worktree', repo: value[1], branch: value[2], machine };
}

export function sessionIdentity(key: string): SessionIdentity | null {
  try {
    const value: unknown = JSON.parse(key);
    if (!Array.isArray(value)) return null;
    if (value[0] === 'terminal') return parseTerminalIdentity(value);
    if (value[0] === 'worktree') return parseWorktreeIdentity(value);
  } catch {
    /* An arbitrary label is not an identity. */
  }
  return null;
}

/** Display text is never used to address a registry entry. */
export function sessionLabel(key: string): string {
  const id = sessionIdentity(key);
  return id?.kind === 'worktree' ? id.branch : id?.id ?? key;
}

export function keyForWorktree(
  wt: Pick<WorktreeInfo, 'branch' | 'path'>,
  repo?: string
): string {
  return worktreeSessionKey(wt.branch || basename(wt.path), repo);
}
