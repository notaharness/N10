/**
 * Editor-area tab model (VS Code semantics, simplified):
 *   • `item` tabs are keyed by *repository plus* sidebar item key; one
 *     tab per item.
 *   • A single-click opens a *preview* tab (italic title) that gets
 *     replaced by the next preview in the same repository;
 *     double-click or any interaction pins it.
 *   • `settings` is a singleton tab, and belongs to no repository.
 *
 * The strip outlives the open repository: opening another repo leaves
 * the previous one's tabs in place so their agents stay in sight. Every
 * action that names a repository therefore carries it explicitly, and
 * `sync-items` only ever reconciles the tabs of the repo it was given —
 * two repos routinely share branch names and so share item keys.
 */

import {
  autoOpenKey,
  isForeignTab,
  standsFor,
  tabHome,
  tabIdFor,
  terminalTabId,
  type Tab,
} from './tab-identity.js';

export type { ItemTab, Tab, TerminalTab } from './tab-identity.js';
export type { TerminalEntry } from './tab-terminals.js';
export type { ForeignSessionEntry } from './tab-foreign.js';
import { closeTab } from './tab-close.js';
import { openForeign, type ForeignSessionEntry } from './tab-foreign.js';
import { pinLive, rekey } from './tab-sync.js';
import {
  openTerminal,
  syncTerminals,
  type TerminalEntry,
} from './tab-terminals.js';

/** One sidebar item as the tab model needs it. */
export interface ItemEntry {
  itemKey: string;
  branch: string;
  /** What the item is called on screen; remembered on the tab. */
  title?: string;
  /** Whether an agent is live on this item right now. */
  running?: boolean;
  /** PTY session name, when the item has one. Present on every
   *  worktree row whether or not an agent was ever started, so it says
   *  nothing about liveness on its own — `running` does. */
  sessionName?: string;
  /** The worktree checkout the item lives in, when it has one. */
  worktree?: string;
  /** The branch the item's agent session was created for, when the
   *  worktree has since switched to another. */
  sessionBranch?: string;
}

export interface TabsState {
  tabs: Tab[];
  activeId: string | null;
  /** Sessions already auto-opened once by `sync-items`, as
   *  `autoOpenKey(repo, sessionName)`. History, not derivable from
   *  `tabs`: a tab the user closed and one that was never opened look
   *  identical, and only this tells them apart. Repo-qualified for the
   *  same reason tab ids are — the PTY registry keys sessions by bare
   *  branch name, so two repos' agents share a name. */
  autoOpened: readonly string[];
  /** The tab each repository was last looked at on, by repo root. Lets
   *  opening a repository again land where it was left rather than on
   *  whichever of its tabs happens to be rightmost. */
  lastActiveByRepo: Readonly<Record<string, string>>;
  /** Tabs opened in the background — an agent that started outside
   *  the app while the user was looking at something else — and not
   *  activated since. The strip marks them until they are first seen. */
  unseen: readonly string[];
}

/** The repository the active tab belongs to, if it belongs to one. A
 *  plain-folder terminal belongs to none, so activating it switches
 *  nothing. */
export function activeTabRepo(state: TabsState): string | null {
  const active = state.tabs.find((t) => t.id === state.activeId);
  return active ? tabHome(active) : null;
}

export const EMPTY_TABS: TabsState = {
  tabs: [],
  activeId: null,
  autoOpened: [],
  lastActiveByRepo: {},
  unseen: [],
};

export type TabsAction =
  | { type: 'open-item'; repo: string; itemKey: string; preview: boolean }
  | { type: 'open-settings' }
  | { type: 'pin'; id: string }
  | { type: 'activate'; id: string }
  | { type: 'close'; id: string; repo?: string }
  | { type: 'close-others'; id: string }
  | { type: 'close-all' }
  | { type: 'move'; id: string; targetId: string; side: 'before' | 'after' }
  /** The one reconciliation dispatched from Workspace's effect: the
   *  repo's sidebar items *and* the host's terminal listing, applied as
   *  one pure step. Terminals ride along on every sync rather than
   *  getting a dispatch of their own — carrying an empty `entries` still
   *  reconciles the terminal strip on its own, since an empty list is a
   *  no-op for the item passes.
   *
   *  `terminals` is the host's answer, and `undefined` is no answer
   *  yet — not an empty one. The listing is authoritative when it is
   *  there: a terminal tab it does not name has ended and closes. With
   *  no listing the terminal tabs are left exactly as they are, so a
   *  tick before the first answer cannot close every one of them.
   *
   *  `foreign` is the host's other listing: agents alive in *other*
   *  repositories, each of which gets a tab in its own group once
   *  (see `tab-foreign.ts`). Also `undefined` before the first
   *  answer. */
  | {
      type: 'sync-items';
      repo: string;
      entries: ItemEntry[];
      terminals?: TerminalEntry[];
      foreign?: ForeignSessionEntry[];
    }
  /** Open (or activate) the tab for a terminal the host just started. */
  | { type: 'open-terminal'; terminal: TerminalEntry }
  /** The host says the process behind a terminal ended, by name — the
   *  shell exited, the agent quit, tmux ended the session. Its tab
   *  closes on that word alone, whether or not a listing ever named it:
   *  a process that died between the launch answer and the first
   *  listing would otherwise leave a tab whose close asks to end a
   *  session that is already gone. Focus follows the close rules for
   *  `repo`, the one in view. A name with no terminal tab is nothing. */
  | { type: 'terminal-ended'; name: string; repo?: string }
  /** A repository was opened. Dispatched for every open, tab-driven or
   *  not; it only does something when the tab in front of the user
   *  belongs to somewhere else. */
  | { type: 'repo-opened'; repo: string }
  /** A close asked its session to be killed and the kill failed. The
   *  tab already closed synchronously — the strip must not wait on a
   *  round trip to feel responsive — so the session is still running
   *  behind no tab at all unless the next sync is told it has not
   *  been seen. Forgetting these keys is what lets it: the same
   *  session or terminal reopens on the next sidebar poll or terminal
   *  listing instead of staying invisible for the life of the strip. */
  | { type: 'forget-auto-opened'; keys: string[] };

function pinTab(tabs: Tab[], id: string): Tab[] {
  return tabs.map((t): Tab => {
    if (t.id !== id || t.kind !== 'item') return t;
    return { ...t, preview: false };
  });
}

/** Activate a tab, ignoring an id that is no longer on the strip. */
function activateTab(state: TabsState, id: string): TabsState {
  return state.tabs.some((t) => t.id === id)
    ? { ...state, activeId: id }
    : state;
}

/** Keep only `id`; whatever survives becomes active. */
function closeOtherTabs(state: TabsState, id: string): TabsState {
  const tabs = state.tabs.filter((t) => t.id === id);
  return { ...state, tabs, activeId: tabs[0]?.id ?? null };
}

export function reduce(state: TabsState, action: TabsAction): TabsState {
  return remember(markSeen(apply(state, action)));
}

/**
 * Drop the active tab, and every tab no longer on the strip, from
 * `unseen`. Derived for the same reason `remember` is: every path that
 * activates or closes a tab passes through here.
 */
function markSeen(state: TabsState): TabsState {
  if (state.unseen.length === 0) return state;
  const open = new Set(state.tabs.map((t) => t.id));
  const unseen = state.unseen.filter(
    (id) => id !== state.activeId && open.has(id)
  );
  return unseen.length === state.unseen.length ? state : { ...state, unseen };
}

/**
 * Note which tab the active repository was left on.
 *
 * Derived rather than dispatched, so no action can forget to do it —
 * every path that moves `activeId` passes through here.
 */
function remember(state: TabsState): TabsState {
  const active = state.tabs.find((t) => t.id === state.activeId);
  const home = active ? tabHome(active) : null;
  if (!active || home === null) return state;
  if (state.lastActiveByRepo[home] === active.id) return state;
  return {
    ...state,
    lastActiveByRepo: { ...state.lastActiveByRepo, [home]: active.id },
  };
}

/**
 * Show the repository that was just opened rather than the tab the user
 * was on before, when that tab belongs to somewhere else.
 *
 * Without this, switching repositories leaves the previous repo's tab
 * active — so the workspace you asked for opens onto a pane explaining
 * that it belongs to the one you left. A repo with no tabs of its own
 * goes to no active tab at all, which is the editor's empty state, with
 * the other repositories' tabs still on the strip.
 *
 * The settings tab is nobody's, so it survives a repo change.
 */
function focusRepo(state: TabsState, repo: string): TabsState {
  const active = state.tabs.find((t) => t.id === state.activeId);
  if (active && !isForeignTab(active, repo)) return state;
  const remembered = state.tabs.find(
    (t) => t.id === state.lastActiveByRepo[repo]
  );
  const own =
    remembered ?? [...state.tabs].reverse().find((t) => tabHome(t) === repo);
  const activeId = own?.id ?? null;
  return activeId === state.activeId ? state : { ...state, activeId };
}

/** The actions that take tabs off the strip. */
type CloseAction = Extract<
  TabsAction,
  { type: 'close' | 'close-others' | 'close-all' | 'terminal-ended' }
>;

const CLOSE_ACTIONS: ReadonlySet<TabsAction['type']> = new Set<
  CloseAction['type']
>(['close', 'close-others', 'close-all', 'terminal-ended']);

function isCloseAction(action: TabsAction): action is CloseAction {
  return CLOSE_ACTIONS.has(action.type);
}

function applyClose(state: TabsState, action: CloseAction): TabsState {
  switch (action.type) {
    case 'close':
      return closeTab(state, action.id, action.repo);
    case 'terminal-ended':
      return closeTab(state, terminalTabId(action.name), action.repo);
    case 'close-others':
      return closeOtherTabs(state, action.id);
    case 'close-all':
      // `autoOpened` survives on purpose: closing every tab is a manual
      // act, and re-opening the running agents on the next sidebar poll
      // would undo it.
      return { ...state, tabs: [], activeId: null };
  }
}

/** The actions about item and settings tabs — the strip as it was
 *  before terminals joined it, minus the closes. `sync-items` stays in
 *  this union: its item passes (`applyStrip`'s case below) read only
 *  `repo`/`entries`, and the `terminals` field rides along for
 *  {@link apply} to hand to `syncTerminals` once the item passes have
 *  settled. */
type StripAction = Exclude<TabsAction, { type: 'open-terminal' } | CloseAction>;

function apply(state: TabsState, action: TabsAction): TabsState {
  if (action.type === 'open-terminal') {
    return openTerminal(state, action.terminal);
  }
  if (isCloseAction(action)) {
    return applyClose(state, action);
  }
  if (action.type === 'sync-items') {
    // One dispatch, one pure step: the repo's items and the host's
    // terminal listing are reconciled together rather than from two
    // effects racing into the reducer separately.
    const strip = applyStrip(state, action);
    const withTerminals = action.terminals
      ? syncTerminals(strip, action.repo, action.terminals)
      : strip;
    return action.foreign
      ? openForeign(withTerminals, action.repo, action.foreign)
      : withTerminals;
  }
  return applyStrip(state, action);
}

function applyStrip(state: TabsState, action: StripAction): TabsState {
  switch (action.type) {
    case 'open-item':
      return openItem(state, action.repo, action.itemKey, action.preview);
    case 'open-settings':
      return openSettings(state);
    case 'pin':
      return { ...state, tabs: pinTab(state.tabs, action.id) };
    case 'activate':
      return activateTab(state, action.id);
    case 'move':
      return moveTab(state, action.id, action.targetId, action.side);
    case 'sync-items':
      return pinLive(
        autoOpenRunning(
          rekey(state, action.repo, action.entries),
          action.repo,
          action.entries,
          // The strip as the user last saw it. Auto-open's already-open
          // guard is a question about history, and re-keying is not
          // part of the history it asks about — see `autoOpenRunning`.
          state.tabs
        ),
        action.repo,
        action.entries
      );
    case 'repo-opened':
      return focusRepo(state, action.repo);
    case 'forget-auto-opened':
      return forgetAutoOpened(state, action.keys);
  }
}

/** Drop the given keys from `autoOpened`, so a session or terminal a
 *  failed kill left running is offered again on the next sync rather
 *  than staying invisible for the life of the strip. A no-op set
 *  returns the same state object. */
function forgetAutoOpened(state: TabsState, keys: string[]): TabsState {
  if (keys.length === 0) return state;
  const drop = new Set(keys);
  const autoOpened = state.autoOpened.filter((k) => !drop.has(k));
  return autoOpened.length === state.autoOpened.length
    ? state
    : { ...state, autoOpened };
}

/**
 * Activate the tab for an item, opening one if none is on it yet.
 *
 * The search is {@link standsFor}: by itemKey, and by the id the tab
 * was opened with — a re-keyed tab (see `sync-items`) keeps its
 * original id, so a tab opened as `branch:x` and since re-keyed to
 * `pr:n` must be found when `branch:x` is opened again, which the
 * palette does whenever the branch isn't in the sidebar model yet.
 * Panes are keyed by tab id, so two tabs sharing one would render each
 * other's content and closing one would act on the wrong tab — which
 * is also why a tab that followed its worktree off the item it was
 * opened on does not match by id, and the new tab takes a free one
 * ({@link tabIdFor}).
 *
 * Confined to `repo`: the same item key in another repository is a
 * different item, and matching it would hand this repo's click to a
 * tab pointing at someone else's branch.
 */
function openItem(
  state: TabsState,
  repo: string,
  itemKey: string,
  preview: boolean
): TabsState {
  const existing = state.tabs.find((t) => standsFor(t, repo, itemKey));
  if (existing) {
    const tabs = preview ? state.tabs : pinTab(state.tabs, existing.id);
    return { ...state, tabs, activeId: existing.id };
  }
  const id = tabIdFor(state.tabs, repo, itemKey);
  const next: Tab = { id, kind: 'item', repo, itemKey, preview };
  // Replace this repo's preview tab (if any) instead of stacking.
  // Scoped to the repo: another repository's preview tab is a tab the
  // user can no longer see, and swallowing it on a click over here
  // would delete work in a window they are not looking at.
  const previewIdx = state.tabs.findIndex(
    (t) => t.preview && t.kind === 'item' && t.repo === repo
  );
  if (preview && previewIdx >= 0) {
    const tabs = [...state.tabs];
    tabs[previewIdx] = next;
    return { ...state, tabs, activeId: id };
  }
  return { ...state, tabs: [...state.tabs, next], activeId: id };
}

/** Settings is a singleton tab: open it once, activate it thereafter. */
function openSettings(state: TabsState): TabsState {
  if (state.tabs.some((t) => t.id === 'settings')) {
    return { ...state, activeId: 'settings' };
  }
  return {
    ...state,
    tabs: [...state.tabs, { id: 'settings', kind: 'settings', preview: false }],
    activeId: 'settings',
  };
}

/** Drag-reorder: lift a tab out of the strip and drop it beside another. */
function moveTab(
  state: TabsState,
  id: string,
  targetId: string,
  side: 'before' | 'after'
): TabsState {
  if (id === targetId) return state;
  const from = state.tabs.findIndex((t) => t.id === id);
  if (from < 0) return state;
  const tabs = [...state.tabs];
  const [moved] = tabs.splice(from, 1);
  const at = tabs.findIndex((t) => t.id === targetId);
  if (at < 0) return state;
  tabs.splice(side === 'after' ? at + 1 : at, 0, moved);
  return { ...state, tabs };
}

/**
 * Every running agent gets a tab: restores the tabs for tmux sessions
 * that survived a restart, and surfaces sessions started elsewhere.
 *
 * Each session is auto-opened at most once — recorded in `autoOpened`,
 * which is why a tab the user closes stays closed while the sidebar
 * keeps reporting the agent — and never when a tab for its key is
 * already open, so this can't steal focus from what the user is
 * looking at either.
 *
 * With a tab already in front of the user, the new one opens in the
 * background and joins `unseen`: an agent started from a shell or by
 * an orchestrator is news, not a request to move. With nothing active
 * — the strip at launch, or after the user closed everything — it
 * takes focus, as there is no place to lose. Tabs the user asks for
 * through the UI go through `open-item` and are focused there.
 *
 * `openTabs` answers that already-open question, and it is the strip
 * *before* `rekey` ran, not after. The two differ only where re-keying
 * collapsed a duplicate onto the survivor: the tab carrying the id
 * `item:<key>` is gone from the new strip, but it was open, and the
 * collapse was bookkeeping rather than the user closing anything.
 * Asking the post-rekey strip answers "no tab" there, and the
 * `open-item` that follows finds the survivor by its itemKey and
 * activates it — moving the focus off whatever the user had in front
 * of them, on a sidebar poll they never asked for.
 */
function autoOpenRunning(
  state: TabsState,
  repo: string,
  entries: ItemEntry[],
  openTabs: readonly Tab[]
): TabsState {
  const opened = new Set(state.autoOpened);
  // Decided once for the whole sync: the launch restore opens every
  // surviving agent onto an empty strip, and only the first of them
  // would otherwise see nothing active.
  const background = state.activeId !== null;
  let next = state;
  let changed = false;
  for (const e of entries) {
    if (!e.running || !e.sessionName) continue;
    const seenKey = autoOpenKey(repo, e.sessionName);
    if (opened.has(seenKey)) continue;
    opened.add(seenKey);
    changed = true;
    if (openTabs.some((t) => standsFor(t, repo, e.itemKey))) continue;
    const shown = openItem(next, repo, e.itemKey, false);
    next = background ? behindActive(next, shown) : shown;
  }
  return changed ? { ...next, autoOpened: [...opened] } : next;
}

/** `opened`, with focus left where `state` had it. A tab the open
 *  added is marked unseen; one it found already on the strip — a
 *  re-keyed tab the user opened themselves — is not news. */
function behindActive(state: TabsState, opened: TabsState): TabsState {
  const id = opened.activeId;
  const added = id !== null && !state.tabs.some((t) => t.id === id);
  return {
    ...opened,
    activeId: state.activeId,
    unseen: added ? [...state.unseen, id] : state.unseen,
  };
}
