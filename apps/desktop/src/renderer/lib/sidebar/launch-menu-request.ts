import { useSyncExternalStore } from 'react';

// A request to open a branch's session menu, from somewhere other than
// the tab that owns the menu: the sidebar (Enter, double-click, the
// row's "Launch agent…") and the command palette (checking out a
// branch lands the user in the new worktree's menu, like the TUI).
//
// Keyed by branch rather than tab or item key: a worktree tab is
// re-keyed from `branch:x` to `pr:n` once its pull request is known,
// and the item behind a freshly created worktree does not exist yet
// when the request is filed — the branch is the one name everything
// agrees on throughout.
//
// One request at a time. Filing a new one replaces the old: the
// selection it accompanies is the user's newest intent, and a stale
// request must not pop a menu on a later, unrelated tab.
//
// The pane copies a request into its own state in the render that
// can honor it, so nothing in its lifecycle can lose it afterwards
// (StrictMode replays mount effects; clearing on unmount closed the
// menu before it opened). A request nobody honors expires instead of
// popping a menu on a later visit — the same TTL rule as core's
// session-menu-request.ts.

export const LAUNCH_MENU_REQUEST_TTL_MS = 10_000;

let pending: { branch: string; filedAt: number } | null = null;
const subscribers = new Set<() => void>();

function notify(): void {
  for (const fn of [...subscribers]) fn();
}

export function requestLaunchMenu(
  branch: string,
  now: number = Date.now()
): void {
  pending = { branch, filedAt: now };
  notify();
}

/** Drop the request for `branch`; a request for another branch stays. */
export function clearLaunchMenuRequest(branch: string): void {
  if (pending?.branch !== branch) return;
  pending = null;
  notify();
}

/** The branch a fresh request is pending for, if any. */
export function pendingLaunchMenu(now: number = Date.now()): string | null {
  if (!pending) return null;
  return now - pending.filedAt <= LAUNCH_MENU_REQUEST_TTL_MS
    ? pending.branch
    : null;
}

export function subscribeLaunchMenu(cb: () => void): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

/** True while a fresh request is pending for `branch`. */
export function useLaunchMenuRequested(branch: string): boolean {
  return useSyncExternalStore(
    subscribeLaunchMenu,
    () => pendingLaunchMenu() === branch
  );
}

export function __resetLaunchMenuRequestForTests(): void {
  pending = null;
  subscribers.clear();
}
