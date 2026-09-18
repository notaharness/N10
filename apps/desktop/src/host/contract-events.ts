/**
 * The push half of the host contract: what the main process sends the
 * renderer without being asked, and what rides on each channel.
 *
 * Everything else in `contract.ts` is request/response — the renderer
 * calls, the host answers. These are the other direction, and they are
 * a different kind of thing to get right: a channel name is a string
 * shared by three files that never import each other's implementations
 * (main sends, preload subscribes, renderer handles), so the names and
 * their payloads are declared once, here, and nowhere else.
 *
 * `contract.ts` re-exports all of it, so callers still import from one
 * place and nothing outside this directory needs to know about the
 * split.
 */

import type { MachineView } from './contract-machines.js';

// ── Sessions (agent terminals) ───────────────────────────────────

export interface SessionDataEvent {
  name: string;
  data: string;
  /** Monotonic per-session chunk counter; lets a late subscriber drop
   *  chunks already covered by a `getSessionBuffer` snapshot. */
  seq: number;
}

export interface SessionExitEvent {
  retained?: boolean;
  name: string;
  code: number;
}

/** Channels the main process pushes events on (ipcRenderer.on). */
export const SESSION_EVENTS = {
  data: 'n10/session/data',
  exit: 'n10/session/exit',
} as const;

// ── Machines (beam peers) ─────────────────────────────────────────

/**
 * The whole machines list, pushed on any change: a peer connects or
 * disconnects, a probe result lands, a queue drains, a peer is paired,
 * renamed, revoked or forgotten. The renderer writes this straight into
 * the query cache (no round trip) — see decisions.md D6/D7 for why the
 * five reachability states and queue depth have to be pushed rather
 * than polled: a probe interval measured in tens of seconds would
 * otherwise make a freshly-connected peer look unreachable for a while.
 */
export const MACHINES_EVENTS = {
  changed: 'n10/machines/changed',
} as const;

export type MachinesChangedEvent = MachineView[];

// ── Native menus ─────────────────────────────────────────────────

/** Commands the native application menu sends to the renderer. */
export type MenuCommand =
  | 'open-repo'
  | 'switch-repo'
  | 'new-worktree'
  | 'new-terminal'
  | 'open-settings'
  | 'close-tab'
  | 'command-palette'
  | 'toggle-sidebar'
  | 'refresh-remote'
  | 'set-theme'
  | 'open-url'
  | 'show-shortcuts'
  | 'about';

export interface MenuCommandEvent {
  command: MenuCommand;
  arg?: string;
}

export const MENU_EVENTS = {
  command: 'n10/menu/command',
} as const;

// ── Remote sync ──────────────────────────────────────────────────

export const SYNC_EVENTS = {
  notice: 'n10/sync/notice',
  /**
   * Background remote data (the pull request list) has landed and the
   * sidebar model would now answer differently.
   *
   * `getSidebarModel` deliberately never waits for the network, so
   * without this the first pull requests of a session would appear
   * whenever the renderer's poll interval next came round — up to four
   * seconds after the host already had them.
   */
  remote: 'n10/sync/remote',
} as const;

// ── Discovery ────────────────────────────────────────────────────

export const DISCOVERY_EVENTS = {
  /**
   * A worktree or agent session that this process did not create has
   * appeared or gone away, and the sidebar model would now answer
   * differently.
   *
   * Separate from `SYNC_EVENTS.remote` because the two say different
   * things: that one means the pull request list arrived from the
   * provider, this one means the local world changed underneath us.
   * A renderer may well want to react to only one of them.
   */
  changed: 'n10/sidebar/discovered',
} as const;

// ── Babysitting ──────────────────────────────────────────────────

export const BABYSIT_EVENTS = {
  /**
   * A babysitter did something the sidebar cannot wait a poll to show:
   * started an agent to receive an update, or ended because the pull
   * request merged or closed. A status that merely moved — a poll, a
   * hold, a delivery into a running agent — reaches the renderer on
   * the sidebar item and needs no event.
   */
  changed: 'n10/babysit/changed',
} as const;

export interface BabysitChangedEvent {
  /** An agent was started in the branch's worktree; a sidebar row and
   *  a session appeared with it. */
  spawned?: { prId: number; name: string };
  /** The watch stopped on its own. Named, because the row it was on is
   *  usually gone with it. */
  ended?: { prId: number; sourceBranch: string };
}

/** A user-facing event from the host's remote sync loop (auto-deleted
 *  merged branch, blocked auto-delete, …), toasted by the renderer. */
export interface SyncNoticeEvent {
  message: string;
  kind: 'success' | 'warning';
}
