import { realpathSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import type { MachineExecutor, WorktreeInfo } from '@n10/worktree-manager';
import { getRepoRoot } from './repo-root.js';

/** The machine a session lives on: a beam `peerId`, or `'local'` for
 *  this machine. Not a label — labels are renameable and local to each
 *  side; the UI resolves this id to a label for display. */
export const LOCAL_MACHINE = 'local';

export type SessionIdentity =
  | { kind: 'worktree'; repo: string; path: string; machine: string }
  | { kind: 'terminal'; id: string; machine: string };

/**
 * A worktree checkout's identity: its physical absolute path as resolved
 * on the machine that holds it — what `pwd -P` prints inside it there,
 * and what Orchestra records. Here that is `realpath`, or the resolved
 * path as given once the directory is gone. Another machine's path is
 * kept as given: it must already be canonical, which
 * {@link resolveRemoteWorktreePath} makes it when the checkout is first
 * resolved there.
 */
export function canonicalWorktreePath(
  path: string,
  machine: string = LOCAL_MACHINE
): string {
  // No path is no checkout — not the process's working directory.
  if (machine !== LOCAL_MACHINE || !path) return path;
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/** `pwd -P` in `path` on the machine `executor` runs on — the canonical
 *  form of another machine's checkout. The path as given when it cannot
 *  be resolved there. */
export async function resolveRemoteWorktreePath(
  path: string,
  executor: MachineExecutor
): Promise<string> {
  try {
    const { stdout, code } = await executor.run(['pwd', '-P'], { cwd: path });
    const resolved = stdout.trim();
    return code === 0 && resolved ? resolved : path;
  } catch {
    return path;
  }
}

/**
 * Opaque internal keys. JSON tuples keep punctuation and namespaces
 * distinct. A worktree session is keyed by its checkout, not its
 * branch: `git switch`, a branch rename or a detached HEAD inside the
 * worktree leave the key alone, and a second worktree on the same
 * branch is a different key. The machine is an *optional trailing segment*, omitted
 * entirely when it is `'local'` — every call site that does not pass
 * one keeps producing exactly the key it produces today (decisions.md
 * D2). Do not renumber the tuple; a new dimension is always appended.
 */
export function worktreeSessionKey(
  worktreePath: string,
  repo = getRepoRoot() ?? process.cwd(),
  machine: string = LOCAL_MACHINE
): string {
  const path = canonicalWorktreePath(worktreePath, machine);
  return machine === LOCAL_MACHINE
    ? JSON.stringify(['worktree', repo, path])
    : JSON.stringify(['worktree', repo, path, machine]);
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
    : { kind: 'worktree', repo: value[1], path: value[2], machine };
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
  return id?.kind === 'worktree' ? basename(id.path) : id?.id ?? key;
}

export function keyForWorktree(
  wt: Pick<WorktreeInfo, 'path'>,
  repo?: string
): string {
  return worktreeSessionKey(wt.path, repo);
}
