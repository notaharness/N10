import { TerminalEmulator } from '@n10/terminal';
import type { SessionBackend } from '@n10/terminal';
import * as activity from './activity.js';
import { remove as removeInactiveAlert } from './inactive-alerts.js';

export interface PtyEntry {
  pty: SessionBackend;
  agent?: string;
  /** A worktree session's `@orchestra-branch`: the branch it was
   *  created for, which its checkout may since have switched away from. */
  createdFor?: string;
  emu: TerminalEmulator;
  exited: boolean;
  exitCode?: number;
  /** ms-since-epoch when this entry was added to the registry. Drives
   *  the active-sessions tab bar's stable spawn-order sort. Restarting
   *  a session via `spawnSession` (which kills the old entry first)
   *  produces a fresh value, so the restarted tab moves to the end of
   *  the bar — matching browser-tab semantics. */
  spawnedAt: number;
}

export interface NamedPtyEntry extends PtyEntry {
  name: string;
}

const registry = new Map<string, PtyEntry>();

// Subscribers notified when an agent PTY exits on its own (Ctrl-D twice
// in claude, the agent crashing, etc.). React-side state derives the
// sidebar's "running" indicator from `isSessionAlive`, so we push a
// refresh on exit — the derived state would otherwise keep showing the
// session as running until the user next touched it. (The entry itself
// stays in the registry so its final frame remains viewable.)
const exitSubscribers = new Set<(name: string) => void>();

export function onSessionExit(cb: (name: string) => void): () => void {
  exitSubscribers.add(cb);
  return () => exitSubscribers.delete(cb);
}

/** Register one local connection. Identity and process creation belong to
 * the session launcher; this registry owns terminal rendering and activity. */
export function spawnSession(
  name: string,
  pty: SessionBackend,
  cols: number,
  rows: number,
  agent?: string,
  createdFor?: string
): NamedPtyEntry {
  // Respawn under the same name: dispose (soft) the prior entry. On
  // tmux this detaches without killing, so the new spawn resolves the
  // same tmux session and re-attaches — preserving its scrollback.
  const existing = registry.get(name);
  if (existing) {
    existing.pty.dispose();
    existing.emu.dispose();
    activity.detach(name);
    removeInactiveAlert(name);
    registry.delete(name);
  }

  const emu = new TerminalEmulator(cols, rows);
  const entry: NamedPtyEntry = {
    name,
    pty,
    emu,
    agent,
    ...(createdFor ? { createdFor } : {}),
    exited: pty.processState?.running === false,
    exitCode: pty.processState?.exitCode,
    spawnedAt: Date.now(),
  };

  pty.onData((data) => {
    void emu.write(data);
  });

  pty.onExit((code) => {
    entry.exited = true;
    entry.exitCode = code;
    // The agent exited on its own. Keep the entry in the registry: its
    // final output frame + exit code stay viewable (usePtySession
    // renders them off `entry.exited`) and the row keeps flashing
    // "unseen output". `isSessionAlive` now returns false, so the
    // sidebar running indicator flips green → gray once subscribers
    // refresh. We deliberately do NOT detach activity here — activity
    // tracks the exit via its own onExit handler, and detaching would
    // wipe the state the flash depends on. We DO drop any pending
    // inactive-alert (a session that had gone idle, was enqueued, then
    // exited shouldn't remain an Escape-jump target). Disposing
    // pty/emu and detaching activity falls to killSession or the next
    // same-name spawnSession — both of which can now still reach the
    // entry because it stays in the registry.
    if (registry.get(name) === entry) {
      removeInactiveAlert(name);
      for (const sub of [...exitSubscribers]) sub(name);
    }
  });

  activity.attach(name, pty, emu);
  registry.set(name, entry);
  return entry;
}

export function getSession(name: string): PtyEntry | undefined {
  return registry.get(name);
}

/** Keys held locally, including retained final frames. */
export function sessionNames(): string[] {
  return [...registry.keys()];
}

export function hasSession(name: string): boolean {
  return registry.has(name);
}

/**
 * True only while the PTY is still running. A self-exited session stays
 * in the registry (so its final frame + exit code remain viewable), so
 * `hasSession` alone can't distinguish "present" from "alive". The
 * sidebar running indicator and any "the agent process will be killed"
 * guard derive from this.
 */
export function isSessionAlive(name: string): boolean {
  const entry = registry.get(name);
  return entry !== undefined && !entry.exited;
}

/** Whether the local connection can still recover or deliver data. */
export function hasSessionConnection(name: string): boolean {
  const entry = registry.get(name);
  return !!entry && entry.pty.connectionState !== 'failed';
}

export function hasAnySession(): boolean {
  // Retained final frames are not running processes.
  for (const entry of registry.values()) {
    if (!entry.exited) return true;
  }
  return false;
}

/** Bare registry names — the ones `spawnSession` was called with, not
 *  the tmux names behind them — of every still-running session.
 *  Discovery keys each live tmux session the same way, so one this
 *  process already holds is recognised as owned rather than reported
 *  as an orphan to adopt a second time (worktree sessions are keyed by
 *  the branch they were spawned under, which is exactly what a
 *  mid-session checkout leaves stale). Exited entries are excluded for
 *  the same reason {@link hasAnySession} excludes them: a tombstone
 *  owns nothing. */
export function liveSessionNames(): string[] {
  const names: string[] = [];
  for (const [name, entry] of registry.entries()) {
    if (!entry.exited) names.push(name);
  }
  return names;
}

/** Return the spawn time (ms-since-epoch) for the named session, or
 *  undefined if no PTY entry exists. Used by the tab bar's spawn-order
 *  sort. Per-entry-immutable, so safe to read during render. */
export function getSpawnedAt(name: string): number | undefined {
  return registry.get(name)?.spawnedAt;
}

/** Explicit teardown — used when the user removes a worktree or kills
 *  a session. Calls the backend's `kill()` so persistent backends
 *  (tmux) terminate the underlying session, not just detach. */
export function killSession(name: string): void {
  const entry = registry.get(name);
  if (entry) {
    entry.pty.kill();
    entry.emu.dispose();
    activity.detach(name);
    removeInactiveAlert(name);
    registry.delete(name);
  }
}

/** Release a local connection without killing the hosted tmux session. */
export function detachSession(name: string): void {
  const entry = registry.get(name);
  if (!entry) return;
  entry.pty.dispose();
  entry.emu.dispose();
  activity.detach(name);
  removeInactiveAlert(name);
  registry.delete(name);
}

/** Release a final frame when its terminal tab has closed. */
export function releaseExitedSession(name: string): void {
  if (registry.get(name)?.exited) detachSession(name);
}

/** Soft cleanup — used on n10 process exit. Calls the backend's
 *  `dispose()` so tmux sessions survive and can be reattached on the
 *  next launch.
 */
export function killAll(): void {
  for (const [name, entry] of registry.entries()) {
    entry.pty.dispose();
    entry.emu.dispose();
    activity.detach(name);
    removeInactiveAlert(name);
  }
  registry.clear();
}
