// @n10/core — the shell-agnostic half of n10.
//
// Everything here is plain TypeScript: git, worktrees, PTYs, config,
// providers, keybinding data and pure helpers. Nothing in this library
// imports React, Ink or Electron, and the lint config enforces that.
//
// The shells (the Ink TUI and the Electron desktop) render over this.
// React-flavoured wrappers — contexts, hooks, controllers — live in
// @n10/app-core, which depends on this package and never the reverse.

// ── Input primitives ─────────────────────────────────────────────
export type { KeyPress } from './lib/input/key-press.js';
export { handleTextInput } from './lib/input/handle-text-input.js';

// ── Keybindings ──────────────────────────────────────────────────
export * from './lib/keybindings/index.js';

// ── Settings field model ─────────────────────────────────────────
export {
  AI_PRESETS,
  BOOL_PRESETS,
  BOOL_PRESETS_ON_FIRST,
  EDITOR_PRESETS,
  SYNC_INTERVAL_PRESETS,
  KEYBIND_PRESETS,
  buildSettingsFields,
  resolveValue,
} from './lib/settings/fields.js';
export type { SettingsField } from './lib/settings/fields.js';
export { settingsEffects, hasSettingsEffect } from './lib/settings/effects.js';
export type { SettingsEffect } from './lib/settings/effects.js';

// ── Domain types ─────────────────────────────────────────────────
export * from './lib/types.js';
export * from './lib/activity-config.js';
export * from './lib/plan/plan-types.js';

// ── Session / PTY infrastructure (Node host side) ────────────────
export * from './lib/session-backend.js';
export * from './lib/session-identity.js';
export * from './lib/session-resolver.js';
export * from './lib/session/session-request.js';
export * from './lib/session/open-session.js';
export type * from './lib/terminal/terminal-name.js';
export * from './lib/terminal/launch-terminal.js';
export * from './lib/pty-registry.js';
export {
  attach,
  detach,
  noteInput,
  noteResize,
  noteSeen,
  snapshot,
  idleFor,
  __resetForTests as __resetActivityForTests,
} from './lib/activity.js';
export type { ActivitySnapshot } from './lib/activity.js';
export {
  enqueue,
  dequeueOldest,
  remove,
  peekAll,
  size,
  subscribe,
} from './lib/inactive-alerts.js';
export * from './lib/agents/registry.js';
export * from './lib/agents/agent-options.js';
export * from './lib/session/launch-session.js';
export * from './lib/session/session-launch-context.js';
export * from './lib/session/session-menu.js';
export * from './lib/session/session-menu-request.js';
export * from './lib/session/review-prompt.js';
export * from './lib/session/checkout-plan.js';
export * from './lib/session/relay-target.js';
export * from './lib/sync/remote-sync.js';
export * from './lib/sync/conflicts.js';
export * from './lib/sync/fetch-queue.js';
export * from './lib/pull-requests/pull-request-cache.js';
export * from './lib/discovery/discovery-model.js';
export * from './lib/discovery/session-discovery.js';
export * from './lib/babysit/babysit-model.js';
export * from './lib/babysit/babysit-prompt.js';
export * from './lib/babysit/babysit-observe.js';
export * from './lib/babysit/pr-babysitter.js';
export * from './lib/discovery/worktree-origin.js';
export * from './lib/discovery/live-worktree-sessions.js';

// ── Pure utilities ───────────────────────────────────────────────
export * from './lib/utils/sidebar-items.js';
export * from './lib/utils/session-sort.js';
export * from './lib/utils/running-tabs.js';
export * from './lib/utils/scroll-window.js';
export * from './lib/utils/truncate.js';
export * from './lib/utils/virtual-viewport.js';
export * from './lib/utils/diff-scroll.js';
export * from './lib/utils/pr-utils.js';
export * from './lib/utils/diff-fetcher.js';
export * from './lib/utils/worktree-diff.js';
export * from './lib/utils/language.js';
export * from './lib/utils/resolve-preset-name.js';

// ── Plan store ───────────────────────────────────────────────────
// `remove` is aliased because inactive-alerts' unary `remove(name)`
// (re-exported above) would otherwise shadow plan-store's ternary
// `remove(prId, kind, id)` in the barrel namespace.
export {
  add,
  count,
  has,
  list,
  clear,
  toggle,
  annotate,
  subscribe as subscribePlanStore,
  getSnapshot as getPlanSnapshot,
} from './lib/plan/plan-store.js';
export {
  remove as removePlanItem,
  __resetPlanStoreForTest,
} from './lib/plan/plan-store.js';
export * from './lib/plan/prompt-composer.js';

export {
  worktreeSessionKey,
  keyForWorktree,
  terminalSessionKey,
  sessionIdentity,
  sessionLabel,
  LOCAL_MACHINE,
} from './lib/session-key.js';
export type { SessionIdentity } from './lib/session-key.js';

export {
  setMachineResolver,
  resolveMachine,
  requireMachine,
  pollerFor,
  type MachineResolver,
} from './lib/machine-registry.js';

export { stopSession } from './lib/session/stop-session.js';
export { removeWorktreeSession } from './lib/session/remove-worktree.js';
