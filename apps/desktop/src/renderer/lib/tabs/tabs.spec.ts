import { describe, expect, it } from 'vitest';
import { autoOpenKey, itemTabId } from './tab-identity.js';
import {
  EMPTY_TABS,
  activeTabRepo,
  reduce,
  type ForeignSessionEntry,
  type ItemEntry,
  type TabsState,
  type TerminalEntry,
} from './tabs-model.js';
import { terminalTabId } from './tab-identity.js';

/** The repository every case below is about unless it says otherwise. */
const REPO = '/repos/alpha';
const OTHER = '/repos/beta';

/** The id the strip gives `itemKey` in `repo`. */
const id = (itemKey: string, repo = REPO) => itemTabId(repo, itemKey);

const open = (
  state: TabsState,
  itemKey: string,
  preview = false,
  repo = REPO
) => reduce(state, { type: 'open-item', repo, itemKey, preview });

/** A sidebar sync with no terminal listing to reconcile against — the
 *  state before the host has answered — unless a case hands one over. */
const sync = (
  state: TabsState,
  entries: ItemEntry[],
  repo = REPO,
  terminals: TerminalEntry[] | undefined = undefined
) => reduce(state, { type: 'sync-items', repo, entries, terminals });

const empty: TabsState = EMPTY_TABS;

describe('sync-items', () => {
  it('re-keys a worktree tab when its branch grows a PR', () => {
    let s = open(empty, 'branch:feat-x');
    s = sync(s, [{ itemKey: 'pr:42', branch: 'feat-x' }]);
    expect(s.tabs).toHaveLength(1);
    const tab = s.tabs[0];
    expect(tab.kind === 'item' && tab.itemKey).toBe('pr:42');
    // Original id survives so the mounted pane doesn't remount.
    expect(tab.id).toBe(id('branch:feat-x'));
    expect(s.activeId).toBe(id('branch:feat-x'));
  });

  it('re-keys back when the PR closes, via the stamped branch', () => {
    let s = open(empty, 'branch:feat-x');
    s = sync(s, [{ itemKey: 'pr:42', branch: 'feat-x' }]);
    s = sync(s, [{ itemKey: 'branch:feat-x', branch: 'feat-x' }]);
    const tab = s.tabs[0];
    expect(tab.kind === 'item' && tab.itemKey).toBe('branch:feat-x');
  });

  it('merges with an already-open tab for the new key', () => {
    let s = open(empty, 'branch:feat-x');
    s = open(s, 'pr:42'); // user opened the PR by hand; now active
    s = sync(s, [{ itemKey: 'pr:42', branch: 'feat-x' }]);
    expect(s.tabs).toHaveLength(1);
    const tab = s.tabs[0];
    expect(tab.kind === 'item' && tab.itemKey).toBe('pr:42');
    // The dropped duplicate was active; activity follows the survivor.
    expect(s.activeId).toBe(tab.id);
  });

  it('a pinned duplicate pins the surviving preview tab', () => {
    let s = open(empty, 'branch:feat-x', true); // preview
    s = reduce(s, {
      type: 'open-item',
      repo: REPO,
      itemKey: 'pr:42',
      preview: false,
    });
    s = sync(s, [{ itemKey: 'pr:42', branch: 'feat-x' }]);
    expect(s.tabs).toHaveLength(1);
    const tab = s.tabs[0];
    expect(tab.preview).toBe(false);
  });

  it('returns the same state when nothing changed', () => {
    let s = open(empty, 'branch:feat-x');
    s = sync(s, [{ itemKey: 'branch:feat-x', branch: 'feat-x' }]);
    const again = sync(s, [{ itemKey: 'branch:feat-x', branch: 'feat-x' }]);
    expect(again).toBe(s);
  });

  it('leaves a tab alone when its item vanished entirely', () => {
    let s = open(empty, 'branch:feat-x');
    s = sync(s, [{ itemKey: 'branch:other', branch: 'other' }]);
    const tab = s.tabs[0];
    expect(tab.kind === 'item' && tab.itemKey).toBe('branch:feat-x');
  });

  it('keeps a tab whose key still resolves, even when a PR key shares the branch', () => {
    let s = open(empty, 'branch:feat-x');
    s = sync(s, [
      { itemKey: 'branch:feat-x', branch: 'feat-x' },
      { itemKey: 'pr:42', branch: 'feat-x' },
    ]);
    const tab = s.tabs[0];
    expect(tab.kind === 'item' && tab.itemKey).toBe('branch:feat-x');
  });

  it('a stale stamped-branch tab migrates to the PR-bearing key', () => {
    // Stamp the branch while the key resolves, then let the key go stale.
    let s = open(empty, 'branch:feat-x');
    s = sync(s, [{ itemKey: 'branch:feat-x', branch: 'feat-x' }]);
    s = sync(s, [{ itemKey: 'pr:42', branch: 'feat-x' }]);
    const tab = s.tabs[0];
    expect(tab.kind === 'item' && tab.itemKey).toBe('pr:42');
  });
});

describe('sync-items opens a tab per running agent', () => {
  const live: ItemEntry = {
    itemKey: 'branch:feat-x',
    branch: 'feat-x',
    sessionName: 'n10-feat-x',
    running: true,
  };

  it('opens a pinned tab for an agent it has not seen before', () => {
    const s = sync(empty, [live]);
    expect(s.tabs).toHaveLength(1);
    expect(s.tabs[0].id).toBe(id('branch:feat-x'));
    expect(s.tabs[0].preview).toBe(false);
    expect(s.activeId).toBe(id('branch:feat-x'));
  });

  it('opens it behind the active tab, marked unseen until activated', () => {
    // An agent started from a shell or by an orchestrator while the
    // user is looking at something else must not move them.
    let s = open(empty, 'branch:main');
    s = sync(s, [live]);
    expect(s.tabs.map((t) => t.id)).toEqual([
      id('branch:main'),
      id('branch:feat-x'),
    ]);
    expect(s.activeId).toBe(id('branch:main'));
    expect(s.lastActiveByRepo[REPO]).toBe(id('branch:main'));
    expect(s.unseen).toEqual([id('branch:feat-x')]);

    s = reduce(s, { type: 'activate', id: id('branch:feat-x') });
    expect(s.unseen).toEqual([]);
  });

  it('restores every surviving agent at launch without marking any', () => {
    // The strip starts empty on each launch; the agents tmux kept are
    // not news, and the last of them is where the user lands.
    const a = { ...live, itemKey: 'branch:a', branch: 'a', sessionName: 'a' };
    const b = { ...live, itemKey: 'branch:b', branch: 'b', sessionName: 'b' };
    const s = sync(empty, [a, b]);
    expect(s.tabs.map((t) => t.id)).toEqual([id('branch:a'), id('branch:b')]);
    expect(s.activeId).toBe(id('branch:b'));
    expect(s.unseen).toEqual([]);
  });

  it('does not mark a re-keyed tab the user opened as unseen', () => {
    // Opened as `branch:x`, re-keyed to `pr:5` and so still carrying
    // the `branch:x` id: the running `pr:5` entry finds that tab.
    let s = open(empty, 'branch:x');
    s = sync(s, [{ itemKey: 'pr:5', branch: 'x' }]);
    s = open(s, 'branch:y');
    s = sync(s, [
      { itemKey: 'pr:5', branch: 'x', sessionName: 'x', running: true },
      { itemKey: 'branch:y', branch: 'y' },
    ]);
    expect(s.tabs).toHaveLength(2);
    expect(s.activeId).toBe(id('branch:y'));
    expect(s.unseen).toEqual([]);
  });

  it('forgets an unseen tab that is closed without being opened', () => {
    let s = sync(open(empty, 'branch:main'), [live]);
    s = reduce(s, { type: 'close', id: id('branch:feat-x') });
    expect(s.unseen).toEqual([]);
  });

  it('focuses the tab the user opens, even one that was unseen', () => {
    let s = sync(open(empty, 'branch:main'), [live]);
    s = open(s, 'branch:feat-x');
    expect(s.activeId).toBe(id('branch:feat-x'));
    expect(s.unseen).toEqual([]);
  });

  it('leaves an idle worktree alone even though it has a session name', () => {
    // Every worktree row carries a session name whether or not an agent
    // was ever started; only `running` means there is one.
    const s = sync(empty, [{ ...live, running: false }]);
    expect(s.tabs).toEqual([]);
  });

  it('does not reopen a tab the user closed while the agent runs', () => {
    let s = sync(empty, [live]);
    s = reduce(s, { type: 'close', id: id('branch:feat-x') });
    expect(s.tabs).toEqual([]);
    // The sidebar keeps reporting the agent on every poll.
    s = sync(s, [live]);
    s = sync(s, [live]);
    expect(s.tabs).toEqual([]);
  });

  it('does not reopen running agents after Close All', () => {
    let s = sync(empty, [live]);
    s = reduce(s, { type: 'close-all' });
    s = sync(s, [live]);
    expect(s.tabs).toEqual([]);
  });

  it('does not activate a tab the user already opened when its agent starts', () => {
    let s = open(empty, 'branch:feat-x');
    s = open(s, 'branch:other');
    s = sync(s, [live, { itemKey: 'branch:other', branch: 'other' }]);
    expect(s.activeId).toBe(id('branch:other'));
  });

  it('reopens once the agent stops and a new one starts', () => {
    let s = sync(empty, [live]);
    s = reduce(s, { type: 'close-all' });
    s = sync(s, [{ ...live, running: false }]);
    expect(s.tabs).toEqual([]);
    // A different session on the same item is a new agent — but still
    // only once it is actually running.
    s = sync(s, [{ ...live, sessionName: 'n10-feat-x-2', running: false }]);
    expect(s.tabs).toEqual([]);
    s = sync(s, [{ ...live, sessionName: 'n10-feat-x-2' }]);
    expect(s.tabs).toHaveLength(1);
    expect(s.activeId).toBe(id('branch:feat-x'));
  });

  it('does not steal activation from the tab the user is looking at', () => {
    let s = open(empty, 'branch:other');
    s = sync(s, [{ itemKey: 'branch:other', branch: 'other' }, live]);
    // The agent's tab opened…
    expect(s.tabs.map((t) => t.id)).toContain(id('branch:feat-x'));
    s = reduce(s, { type: 'activate', id: id('branch:other') });
    // …and does not grab focus back on the next poll.
    s = sync(s, [{ itemKey: 'branch:other', branch: 'other' }, live]);
    expect(s.activeId).toBe(id('branch:other'));
  });

  it('keeps one tab when the running item is re-keyed by a PR', () => {
    let s = sync(empty, [live]);
    s = sync(s, [{ ...live, itemKey: 'pr:42' }]);
    expect(s.tabs).toHaveLength(1);
    expect(s.tabs[0].kind === 'item' && s.tabs[0].itemKey).toBe('pr:42');
    // The id is what keeps the agent's terminal pane mounted.
    expect(s.tabs[0].id).toBe(id('branch:feat-x'));
  });

  it('does not follow a collapsed duplicate when its agent starts', () => {
    // The discriminating case for *which* strip the already-open guard
    // is asked about. Three tabs; `branch:x` and `pr:1` are the same
    // item under two identities, so this sync re-keys `branch:x` to
    // `pr:1` and collapses the hand-opened `pr:1` tab into it. The
    // collapsed tab is the one carrying the id `item:pr:1` — the very
    // id auto-open reads to decide the agent already has a tab.
    //
    // Collapsing a duplicate is not the user closing a tab, so it must
    // not hand auto-open a licence to move the focus. The guard is
    // asked about the strip as it stood before re-keying, where
    // `item:pr:1` was open, and the answer is: leave it alone.
    const entries: ItemEntry[] = [
      { itemKey: 'branch:c', branch: 'c' },
      { itemKey: 'pr:1', branch: 'x', sessionName: 'n10-x', running: true },
    ];
    let s = open(empty, 'branch:c');
    s = open(s, 'branch:x');
    s = open(s, 'pr:1');
    s = reduce(s, { type: 'activate', id: id('branch:c') });
    expect(s.activeId).toBe(id('branch:c'));

    s = sync(s, entries);

    // The duplicate collapsed, as it always did…
    expect(s.tabs.map((t) => t.id)).toEqual([id('branch:c'), id('branch:x')]);
    // …and the session counts as auto-opened, so a later poll can't
    // retry the move.
    expect(s.autoOpened).toContain(autoOpenKey(REPO, 'n10-x'));
    // …but the user is still looking at what they were looking at.
    expect(s.activeId).toBe(id('branch:c'));

    s = sync(s, entries);
    expect(s.activeId).toBe(id('branch:c'));
  });
});

// use-close-tabs closes a tab synchronously and kills its session after
// — the strip does not wait on the round trip — so a kill that fails
// leaves the session running behind no tab. It recovers by forgetting
// the auto-open key on error, which is exactly this reducer step.
describe('forget-auto-opened', () => {
  it('reopens a running agent on the next sync once its key is forgotten', () => {
    const live: ItemEntry = {
      itemKey: 'branch:feat-x',
      branch: 'feat-x',
      sessionName: 'n10-feat-x',
      running: true,
    };
    let s = sync(empty, [live]);
    s = reduce(s, { type: 'close', id: id('branch:feat-x') });
    expect(s.tabs).toEqual([]);
    // The kill failed — the agent is still running — but without
    // forgetting the key the poll that reports it keeps reading as
    // already seen, forever.
    s = sync(s, [live]);
    expect(s.tabs).toEqual([]);

    s = reduce(s, {
      type: 'forget-auto-opened',
      keys: [autoOpenKey(REPO, 'n10-feat-x')],
    });
    s = sync(s, [live]);
    expect(s.tabs).toHaveLength(1);
    expect(s.tabs[0].id).toBe(id('branch:feat-x'));
  });

  it('is a no-op for a key nothing has auto-opened', () => {
    const s = sync(empty, [{ itemKey: 'branch:x', branch: 'x' }]);
    expect(reduce(s, { type: 'forget-auto-opened', keys: ['nothing'] })).toBe(
      s
    );
  });
});

describe('sync-items pins previews with a live agent', () => {
  it('pins a preview tab once an agent is running on its branch', () => {
    let s = open(empty, 'branch:feat-x', true);
    s = sync(s, [
      {
        itemKey: 'branch:feat-x',
        branch: 'feat-x',
        sessionName: 'n10-feat-x',
        running: true,
      },
    ]);
    expect(s.tabs[0].preview).toBe(false);
  });

  it('leaves a preview tab previewable while nothing runs on it', () => {
    // The bug this replaced pinned on the *presence* of a session name,
    // which every worktree has — so preview replacement never happened.
    let s = open(empty, 'branch:feat-x', true);
    s = sync(s, [
      {
        itemKey: 'branch:feat-x',
        branch: 'feat-x',
        sessionName: 'n10-feat-x',
      },
    ]);
    expect(s.tabs[0].preview).toBe(true);

    // …so the next single click still replaces it rather than stacking.
    s = open(s, 'branch:other', true);
    expect(s.tabs).toHaveLength(1);
    expect(s.tabs[0].kind === 'item' && s.tabs[0].itemKey).toBe('branch:other');
  });

  it('pins a preview whose own row has no agent but whose branch does', () => {
    // A PR row and its worktree row are separate items on one branch;
    // the host attaches the live session to whichever it knows about.
    let s = open(empty, 'pr:42', true);
    s = sync(s, [
      { itemKey: 'pr:42', branch: 'feat-x' },
      {
        itemKey: 'branch:feat-x',
        branch: 'feat-x',
        sessionName: 'n10-feat-x',
        running: true,
      },
    ]);
    const pr = s.tabs.find((t) => t.kind === 'item' && t.itemKey === 'pr:42');
    expect(pr?.preview).toBe(false);
  });
});

describe('open-item after re-key', () => {
  it('activates the re-keyed tab instead of duplicating it', () => {
    let s = open(empty, 'branch:feat-x');
    s = sync(s, [{ itemKey: 'pr:42', branch: 'feat-x' }]);
    s = open(s, 'pr:42');
    expect(s.tabs).toHaveLength(1);
    expect(s.activeId).toBe(id('branch:feat-x'));
  });

  it('reuses the re-keyed tab when its original key is opened again', () => {
    // Found by the property test: the palette opens `branch:x` whenever
    // the branch is not in the sidebar model yet, which after a re-key
    // produced a second tab carrying the first one's id. Panes are
    // keyed by tab id, so the two rendered each other's content.
    let state: TabsState = EMPTY_TABS;
    state = reduce(state, {
      type: 'open-item',
      repo: REPO,
      itemKey: 'branch:a',
      preview: false,
    });
    state = reduce(state, {
      type: 'sync-items',
      repo: REPO,
      entries: [{ itemKey: 'pr:1', branch: 'a' }],
      terminals: [],
    });
    state = reduce(state, {
      type: 'open-item',
      repo: REPO,
      itemKey: 'branch:a',
      preview: false,
    });

    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0].id).toBe(id('branch:a'));
    expect(state.tabs[0].kind === 'item' && state.tabs[0].itemKey).toBe('pr:1');
    expect(state.activeId).toBe(id('branch:a'));
  });

  describe('reordering by drag', () => {
    const three = (): TabsState => {
      let state: TabsState = EMPTY_TABS;
      for (const key of ['a', 'b', 'c']) {
        state = reduce(state, {
          type: 'open-item',
          repo: REPO,
          itemKey: key,
          preview: false,
        });
      }
      return state;
    };
    const order = (state: TabsState) =>
      state.tabs.map((t) => (t.kind === 'item' ? t.itemKey : t.id));

    it('drops a tab after its target', () => {
      const state = reduce(three(), {
        type: 'move',
        id: id('a'),
        targetId: id('c'),
        side: 'after',
      });
      expect(order(state)).toEqual(['b', 'c', 'a']);
    });

    it('drops a tab before its target', () => {
      const state = reduce(three(), {
        type: 'move',
        id: id('c'),
        targetId: id('a'),
        side: 'before',
      });
      expect(order(state)).toEqual(['c', 'a', 'b']);
    });

    it('drops before a target that sits later in the strip', () => {
      // The discriminating case for the index arithmetic: removing the
      // dragged tab shifts the target down one, so a target index read
      // before the removal inserts a slot too far right and the tab
      // lands after its target instead of before it.
      const state = reduce(three(), {
        type: 'move',
        id: id('a'),
        targetId: id('c'),
        side: 'before',
      });
      expect(order(state)).toEqual(['b', 'a', 'c']);
    });

    it('handles a short backwards move without losing the tab', () => {
      // Removing the dragged tab shifts every later index down by one,
      // which is exactly where an off-by-one would land.
      const state = reduce(three(), {
        type: 'move',
        id: id('b'),
        targetId: id('c'),
        side: 'after',
      });
      expect(order(state)).toEqual(['a', 'c', 'b']);
    });

    it('ignores a drop onto itself', () => {
      const before = three();
      const after = reduce(before, {
        type: 'move',
        id: id('b'),
        targetId: id('b'),
        side: 'after',
      });
      expect(after).toBe(before);
    });

    it('ignores a drop onto a tab that is gone', () => {
      // The dragged tab must come back, not vanish with the failed move.
      const before = three();
      const after = reduce(before, {
        type: 'move',
        id: id('a'),
        targetId: id('missing'),
        side: 'after',
      });
      expect(order(after)).toEqual(['a', 'b', 'c']);
    });

    it('keeps the active tab active wherever it lands', () => {
      const before = three();
      const after = reduce(before, {
        type: 'move',
        id: before.activeId as string,
        targetId: id('a'),
        side: 'before',
      });
      expect(after.activeId).toBe(before.activeId);
      expect(after.tabs.some((t) => t.id === after.activeId)).toBe(true);
    });
  });
});

describe('tabs across repositories', () => {
  const live: ItemEntry = {
    itemKey: 'branch:main',
    branch: 'main',
    sessionName: 'main',
    running: true,
  };

  it('keeps two repos on the same branch name as two tabs', () => {
    // Both repositories have a `main`, so both sidebars produce
    // `branch:main`. One tab each, or the second repo's click lands on
    // the first repo's pane.
    let s = open(empty, 'branch:main');
    s = open(s, 'branch:main', false, OTHER);
    expect(s.tabs).toHaveLength(2);
    expect(s.tabs.map((t) => t.id)).toEqual([
      id('branch:main'),
      id('branch:main', OTHER),
    ]);
    expect(s.activeId).toBe(id('branch:main', OTHER));
  });

  it('re-opening a foreign item activates its own tab, not the local one', () => {
    let s = open(empty, 'branch:main');
    s = open(s, 'branch:main', false, OTHER);
    s = open(s, 'branch:main');
    expect(s.tabs).toHaveLength(2);
    expect(s.activeId).toBe(id('branch:main'));
  });

  it('syncing one repo leaves the other repo’s tabs untouched', () => {
    let s = open(empty, 'branch:main', false, OTHER);
    s = open(s, 'branch:feat-x');
    // The other repo has no `feat-x`, and this repo's sidebar says
    // nothing about `main` over there.
    const before = s.tabs.find((t) => t.id === id('branch:main', OTHER));
    s = sync(s, [{ itemKey: 'pr:7', branch: 'feat-x' }]);
    expect(s.tabs.find((t) => t.id === id('branch:main', OTHER))).toBe(before);
  });

  it('never follows a foreign tab onto a same-named local branch', () => {
    // The regression this guards: `branch:main` in the other repo is a
    // stale key here, and the branch stamp resolves to *this* repo's
    // pull request. Re-keying it would point the tab at another
    // repository's PR, and collapse it into the local tab.
    let s = open(empty, 'branch:main', false, OTHER);
    s = sync(s, [{ itemKey: 'pr:7', branch: 'main' }]);
    const foreign = s.tabs.find((t) => t.id === id('branch:main', OTHER));
    expect(foreign?.kind === 'item' && foreign.itemKey).toBe('branch:main');
    expect(foreign?.kind === 'item' && foreign.repo).toBe(OTHER);
  });

  it('auto-opens the same session name once per repository', () => {
    // The PTY registry keys sessions by bare branch name, so both
    // repos' agents are called `main`. One tab each.
    let s = sync(empty, [live]);
    s = sync(s, [live], OTHER);
    expect(s.tabs.map((t) => t.id)).toEqual([
      id('branch:main'),
      id('branch:main', OTHER),
    ]);
    expect(s.autoOpened).toEqual([
      autoOpenKey(REPO, 'main'),
      autoOpenKey(OTHER, 'main'),
    ]);
  });

  it('does not reopen a closed foreign tab when its repo is opened again', () => {
    let s = sync(empty, [live], OTHER);
    s = reduce(s, { type: 'close', id: id('branch:main', OTHER) });
    s = sync(s, [live], OTHER);
    expect(s.tabs).toEqual([]);
  });

  it('does not pin the other repo’s preview tab on a live local agent', () => {
    let s = open(empty, 'branch:main', true, OTHER);
    s = sync(s, [live]);
    const foreign = s.tabs.find((t) => t.id === id('branch:main', OTHER));
    expect(foreign?.preview).toBe(true);
  });

  it('keeps a preview tab per repository', () => {
    // Previewing here must not swallow a tab the user can no longer
    // see — preview replacement is scoped to the repo it happens in.
    let s = open(empty, 'branch:main', true, OTHER);
    s = open(s, 'branch:feat-x', true);
    s = open(s, 'branch:feat-y', true);
    expect(s.tabs.map((t) => t.id)).toEqual([
      id('branch:main', OTHER),
      id('branch:feat-y'),
    ]);
  });

  it('closes, closes-others and closes-all across the whole strip', () => {
    let s = open(empty, 'branch:main', false, OTHER);
    s = open(s, 'branch:feat-x');
    s = reduce(s, { type: 'close-others', id: id('branch:main', OTHER) });
    expect(s.tabs.map((t) => t.id)).toEqual([id('branch:main', OTHER)]);
    expect(s.activeId).toBe(id('branch:main', OTHER));

    s = reduce(s, { type: 'close', id: id('branch:main', OTHER) });
    expect(s.tabs).toEqual([]);
  });
});

describe('activeTabRepo', () => {
  it('names the repository of the active tab', () => {
    const s = open(open(empty, 'branch:a'), 'branch:b', false, OTHER);
    expect(activeTabRepo(s)).toBe(OTHER);
  });

  it('is null for settings, which belongs to no repository', () => {
    const s = reduce(open(empty, 'branch:a'), { type: 'open-settings' });
    expect(activeTabRepo(s)).toBeNull();
  });

  it('is null when the strip is empty', () => {
    expect(activeTabRepo(empty)).toBeNull();
  });
});

describe('repo-opened', () => {
  const openRepo = (state: TabsState, repo: string) =>
    reduce(state, { type: 'repo-opened', repo });

  it('steps off the previous repo’s tab and onto one of its own', () => {
    let s = open(empty, 'branch:feat-x');
    s = open(s, 'branch:main', false, OTHER);
    // Back to the first repo: its own tab comes forward.
    s = openRepo(s, REPO);
    expect(s.activeId).toBe(id('branch:feat-x'));
  });

  it('leaves nothing active when the repo has no tabs of its own', () => {
    // The editor shows its empty state; the other repo's tabs stay on
    // the strip. Leaving the foreign tab active would open the
    // workspace you asked for onto a pane about the one you left.
    let s = open(empty, 'branch:main', false, OTHER);
    s = openRepo(s, REPO);
    expect(s.activeId).toBeNull();
    expect(s.tabs).toHaveLength(1);
  });

  it('returns to the tab the repo was left on, not its rightmost', () => {
    let s = open(empty, 'branch:one');
    s = open(s, 'branch:two');
    s = reduce(s, { type: 'activate', id: id('branch:one') });
    s = open(s, 'branch:main', false, OTHER);
    s = openRepo(s, REPO);
    expect(s.activeId).toBe(id('branch:one'));
  });

  it('falls back to the rightmost tab when the remembered one is gone', () => {
    let s = open(empty, 'branch:one');
    s = open(s, 'branch:two');
    s = open(s, 'branch:main', false, OTHER);
    s = reduce(s, { type: 'close', id: id('branch:two') });
    s = openRepo(s, REPO);
    expect(s.activeId).toBe(id('branch:one'));
  });

  it('does not displace the settings tab, which is nobody’s', () => {
    let s = open(empty, 'branch:feat-x');
    s = reduce(s, { type: 'open-settings' });
    s = openRepo(s, OTHER);
    expect(s.activeId).toBe('settings');
  });

  it('is a no-op when the active tab already belongs to the repo', () => {
    const s = open(empty, 'branch:feat-x');
    expect(openRepo(s, REPO)).toBe(s);
  });
});

describe('closing a tab keeps focus inside the repo in view', () => {
  const closeIn = (state: TabsState, tabId: string, repo: string) =>
    reduce(state, { type: 'close', id: tabId, repo });

  /** alpha's tab sandwiched between two of the other repo's. */
  const sandwich = () => {
    let s = open(empty, 'branch:y1', false, OTHER);
    s = open(s, 'branch:x');
    s = open(s, 'branch:y2', false, OTHER);
    return s;
  };

  it('skips past a foreign neighbour to this repo’s nearest tab', () => {
    // Focus is what the workspace follows, so handing it to alpha here
    // would switch the sidebar, status bar and every query because the
    // user closed a tab — while OTHER still has one open.
    const s = closeIn(sandwich(), id('branch:y2', OTHER), OTHER);
    expect(s.activeId).toBe(id('branch:y1', OTHER));
  });

  it('leaves nothing active when the repo in view has no tab left', () => {
    let s = open(empty, 'branch:x');
    s = open(s, 'branch:y', false, OTHER);
    s = closeIn(s, id('branch:y', OTHER), OTHER);
    expect(s.activeId).toBeNull();
    // …and the other repository's tab is still on the strip.
    expect(s.tabs.map((t) => t.id)).toEqual([id('branch:x')]);
  });

  it('still prefers the tab that slid into place when it is not foreign', () => {
    let s = open(empty, 'branch:one');
    s = open(s, 'branch:two');
    s = open(s, 'branch:three');
    s = closeIn(s, id('branch:two'), REPO);
    expect(s.activeId).toBe(id('branch:three'));
  });

  it('keeps the settings tab eligible — it belongs to no repository', () => {
    let s = open(empty, 'branch:y', false, OTHER);
    s = reduce(s, { type: 'open-settings' });
    s = open(s, 'branch:x');
    s = closeIn(s, id('branch:x'), REPO);
    expect(s.activeId).toBe('settings');
  });

  it('closes an inactive tab without moving focus at all', () => {
    let s = open(empty, 'branch:one');
    s = open(s, 'branch:two');
    s = closeIn(s, id('branch:one'), REPO);
    expect(s.activeId).toBe(id('branch:two'));
  });

  it('falls back to the plain neighbour when no repo is named', () => {
    // The action's `repo` is optional; without it the old rule stands.
    const s = reduce(sandwich(), {
      type: 'close',
      id: id('branch:y2', OTHER),
    });
    expect(s.activeId).toBe(id('branch:x'));
  });
});

describe('sync-items stamps the title', () => {
  const find = (s: TabsState, key: string) =>
    s.tabs.find((t) => t.id === id(key));

  it('remembers what the item is called, and follows a rename', () => {
    let s = open(empty, 'pr:42');
    s = sync(s, [{ itemKey: 'pr:42', branch: 'feat-x', title: 'Add undo' }]);
    expect(find(s, 'pr:42')).toMatchObject({ title: 'Add undo' });
    s = sync(s, [
      { itemKey: 'pr:42', branch: 'feat-x', title: 'Add undo support' },
    ]);
    expect(find(s, 'pr:42')).toMatchObject({ title: 'Add undo support' });
  });

  it('stamps the new title when a tab is re-keyed onto its pull request', () => {
    let s = open(empty, 'branch:feat-x');
    s = sync(s, [
      { itemKey: 'branch:feat-x', branch: 'feat-x', title: 'feat-x' },
    ]);
    s = sync(s, [{ itemKey: 'pr:42', branch: 'feat-x', title: 'Add undo' }]);
    expect(find(s, 'branch:feat-x')).toMatchObject({
      itemKey: 'pr:42',
      title: 'Add undo',
    });
  });

  it('keeps the title through a sync that does not carry one', () => {
    let s = open(empty, 'pr:42');
    s = sync(s, [{ itemKey: 'pr:42', branch: 'feat-x', title: 'Add undo' }]);
    const before = s;
    s = sync(s, [{ itemKey: 'pr:42', branch: 'feat-x' }]);
    expect(s).toBe(before);
  });

  it('leaves another repository’s tabs alone', () => {
    let s = open(empty, 'pr:42', false, OTHER);
    s = sync(s, [{ itemKey: 'pr:42', branch: 'feat-x', title: 'Not yours' }]);
    expect(find(s, 'pr:42') ?? s.tabs[0]).not.toMatchObject({
      title: 'Not yours',
    });
  });
});

/**
 * Terminal tabs: a session bound to a directory. One in a repository
 * root belongs to that repository's group; one anywhere else belongs to
 * nobody, sits in the repo-less group, and is never foreign.
 */
describe('terminal tabs', () => {
  const plain: TerminalEntry = {
    name: 'n10-shell',
    kind: 'shell',
    cwd: '/home/dev/notes',
    displayPath: '~/notes',
    repo: null,
  };
  const inAlpha: TerminalEntry = {
    name: 'n10-agent',
    kind: 'agent',
    cwd: REPO,
    displayPath: REPO,
    repo: REPO,
  };
  const openTerminal = (state: TabsState, terminal: TerminalEntry) =>
    reduce(state, { type: 'open-terminal', terminal });
  // Terminals ride along on the same `sync-items` dispatch Workspace
  // makes; an empty `entries` list is a no-op for the item passes, so
  // this exercises exactly the reconciliation a terminal-only poll
  // produces.
  const syncTerminals = (state: TabsState, terminals: TerminalEntry[]) =>
    reduce(state, { type: 'sync-items', repo: REPO, entries: [], terminals });

  it('opens a pinned tab and activates it', () => {
    const s = openTerminal(empty, plain);
    expect(s.tabs).toEqual([
      expect.objectContaining({
        kind: 'terminal',
        name: plain.name,
        repo: null,
        preview: false,
      }),
    ]);
    expect(s.activeId).toBe(terminalTabId(plain.name));
  });

  it('activates the existing tab rather than opening a second one', () => {
    let s = openTerminal(empty, plain);
    s = open(s, 'branch:x');
    s = openTerminal(s, plain);
    expect(s.tabs).toHaveLength(2);
    expect(s.activeId).toBe(terminalTabId(plain.name));
  });

  // A repo-less terminal is at home everywhere; a repository terminal
  // is foreign anywhere but its own repository — which is what makes
  // activating it open that repository.
  it('reports the repository a terminal belongs to, and none for a plain folder', () => {
    expect(activeTabRepo(openTerminal(empty, plain))).toBeNull();
    expect(activeTabRepo(openTerminal(empty, inAlpha))).toBe(REPO);
  });

  // The restore path: the host lists the terminals tmux gave back, and
  // every one gets a tab — without moving focus, since a terminal from
  // another repository would otherwise switch the workspace at startup.
  it('opens a tab per listed terminal without stealing focus', () => {
    let s = open(empty, 'branch:x');
    s = syncTerminals(s, [plain, inAlpha]);
    expect(s.tabs.map((t) => t.id)).toEqual([
      id('branch:x'),
      terminalTabId(plain.name),
      terminalTabId(inAlpha.name),
    ]);
    expect(s.activeId).toBe(id('branch:x'));
  });

  // Auto-opened once: a tab the user closed stays closed while the host
  // keeps listing the terminal, exactly as for running agents.
  it('does not reopen a terminal tab the user closed', () => {
    let s = syncTerminals(empty, [plain]);
    s = reduce(s, { type: 'close', id: terminalTabId(plain.name) });
    s = syncTerminals(s, [plain]);
    expect(s.tabs).toEqual([]);
  });

  it('returns the same state when the listing changed nothing', () => {
    const s = syncTerminals(empty, [plain]);
    expect(syncTerminals(s, [plain])).toBe(s);
  });

  // Mirrors the item case above: closing a terminal tab kills its
  // session after the tab is already gone, so a failed kill needs its
  // auto-open key forgotten or the still-running terminal never gets a
  // tab back.
  it('reopens a terminal once its auto-open key is forgotten after a failed kill', () => {
    let s = syncTerminals(empty, [plain]);
    s = reduce(s, { type: 'close', id: terminalTabId(plain.name) });
    s = syncTerminals(s, [plain]);
    expect(s.tabs).toEqual([]);

    s = reduce(s, {
      type: 'forget-auto-opened',
      keys: [terminalTabId(plain.name)],
    });
    s = syncTerminals(s, [plain]);
    expect(s.tabs).toHaveLength(1);
    expect(s.tabs[0].id).toBe(terminalTabId(plain.name));
  });

  // The sidebar poll re-keys and pins *item* tabs; a terminal has no
  // item and no branch, and a poll about any repository must leave it
  // exactly as it was.
  it('is untouched by a sidebar sync of any repository', () => {
    const before = openTerminal(openTerminal(empty, plain), inAlpha);
    const after = sync(
      before,
      [{ itemKey: 'branch:x', branch: 'x', sessionName: 'x', running: true }],
      OTHER
    );
    const terminals = (st: TabsState) =>
      st.tabs.filter((t) => t.kind === 'terminal');
    expect(terminals(after)).toHaveLength(2);
    terminals(after).forEach((t, i) => expect(t).toBe(terminals(before)[i]));
  });

  it('brings a repository’s own terminal forward when that repo opens', () => {
    let s = openTerminal(empty, inAlpha);
    s = open(s, 'branch:y', false, OTHER); // now looking at beta
    s = reduce(s, { type: 'repo-opened', repo: REPO });
    expect(s.activeId).toBe(terminalTabId(inAlpha.name));
  });

  it('leaves a plain-folder terminal active across a repo switch', () => {
    let s = open(empty, 'branch:x');
    s = openTerminal(s, plain);
    s = reduce(s, { type: 'repo-opened', repo: OTHER });
    expect(s.activeId).toBe(terminalTabId(plain.name));
  });

  // Workspace dispatches one `sync-items` action carrying the sidebar
  // items and the host's terminal listing together, rather than a
  // second effect dispatching a terminal sync of its own. A single
  // dispatch that reconciles both in one pure step is the whole point
  // of folding them: this pins that a newly-running agent's tab and a
  // newly-listed terminal's tab both land from one `reduce` call, and
  // that the combined dispatch settles to the same state on repeat.
  it('reconciles a newly running agent and a newly listed terminal in one dispatch', () => {
    const running: ItemEntry = {
      itemKey: 'branch:feat-x',
      branch: 'feat-x',
      sessionName: 'n10-feat-x',
      running: true,
    };
    const action = {
      type: 'sync-items' as const,
      repo: REPO,
      entries: [running],
      terminals: [plain],
    };
    const s = reduce(empty, action);
    expect(s.tabs.map((t) => t.id)).toEqual([
      id('branch:feat-x'),
      terminalTabId(plain.name),
    ]);
    // Idempotent: the same combined dispatch settles rather than
    // reopening either tab or moving focus. One more application lets
    // `rekey`'s branch/title stamp catch up to the tab `autoOpenRunning`
    // just opened, the same two-call settle every other stamping test
    // here relies on.
    const settled = reduce(s, action);
    expect(reduce(settled, action)).toBe(settled);
  });

  // The process behind a terminal ended — the shell exited, the agent
  // quit, tmux killed the session from outside — and the host no longer
  // lists it. The tab closes by itself: there is nothing left behind it
  // to show, and no session left to confirm ending.
  describe('when the listing no longer has a terminal', () => {
    it('closes its tab', () => {
      let s = syncTerminals(empty, [plain, inAlpha]);
      s = syncTerminals(s, [inAlpha]);
      expect(s.tabs.map((t) => t.id)).toEqual([terminalTabId(inAlpha.name)]);
    });

    it('hands focus to the tab that slid into its place', () => {
      let s = open(empty, 'branch:x');
      s = syncTerminals(s, [plain]);
      s = open(s, 'branch:y');
      s = reduce(s, { type: 'activate', id: terminalTabId(plain.name) });
      s = syncTerminals(s, []);
      expect(s.activeId).toBe(id('branch:y'));
    });

    // The same rule a close follows: focus is what the workspace
    // follows, so it must not land on another repository's tab
    // because a shell over here exited.
    it('never hands focus to another repository', () => {
      let s = open(empty, 'branch:x');
      s = open(s, 'branch:y', false, OTHER);
      s = openTerminal(s, plain); // active, rightmost
      s = syncTerminals(s, [plain]);
      s = syncTerminals(s, []);
      expect(s.activeId).toBe(id('branch:x'));
    });

    it('leaves item tabs exactly as they were', () => {
      let s = open(empty, 'branch:x');
      s = syncTerminals(s, [plain]);
      const before = s.tabs[0];
      s = syncTerminals(s, []);
      expect(s.tabs).toEqual([before]);
      expect(s.tabs[0]).toBe(before);
    });

    // The host answers the launch before its listing catches up: the
    // tab opens on the launch's own answer, and a sync can land in
    // between with a listing fetched before the terminal existed. That
    // listing says nothing about a terminal it never knew — only one
    // that has named the terminal, and then stops, has seen it end.
    it('spares a tab the host has not listed yet', () => {
      let s = openTerminal(empty, plain);
      s = syncTerminals(s, []);
      expect(s.tabs.map((t) => t.id)).toEqual([terminalTabId(plain.name)]);
      expect(s.activeId).toBe(terminalTabId(plain.name));
      s = syncTerminals(s, [plain]);
      s = syncTerminals(s, []);
      expect(s.tabs).toEqual([]);
    });

    // The stamp of a tab that is still open is not for pruning, listed
    // or not: closing that tab later relies on it, or the listing that
    // still names the terminal until its kill lands would reopen it.
    it('keeps the stamp of an open tab the listing has not named', () => {
      let s = openTerminal(empty, plain);
      s = syncTerminals(s, []);
      s = syncTerminals(s, [plain]);
      s = reduce(s, { type: 'close', id: terminalTabId(plain.name) });
      s = syncTerminals(s, [plain]);
      expect(s.tabs).toEqual([]);
    });

    // A terminal the host lists again is a live one it re-adopted (the
    // user detached from inside tmux and discovery found the session
    // still running), so it gets its tab back rather than running
    // invisibly behind a stale auto-open stamp.
    it('gives the terminal a tab again if the host lists it again', () => {
      let s = syncTerminals(empty, [plain]);
      s = syncTerminals(s, []);
      expect(s.tabs).toEqual([]);
      s = syncTerminals(s, [plain]);
      expect(s.tabs.map((t) => t.id)).toEqual([terminalTabId(plain.name)]);
    });
  });

  // The host says a terminal's process ended, by name, the moment it
  // happens — before any listing has caught up, and possibly before
  // one ever named the terminal at all (a shell whose rc file exits, an
  // agent binary missing under tmux). The tab goes on that word alone,
  // with the same focus rules as a close, so a terminal that died in
  // the gap between the launch answer and the first listing does not
  // leave a tab whose close then asks to end a session that is gone.
  describe('terminal-ended', () => {
    const ended = (state: TabsState, name: string, repo = REPO) =>
      reduce(state, { type: 'terminal-ended', name, repo });

    it('closes the tab of a terminal no listing ever named', () => {
      let s = open(empty, 'branch:x');
      s = openTerminal(s, plain);
      s = ended(s, plain.name);
      expect(s.tabs.map((t) => t.id)).toEqual([id('branch:x')]);
      expect(s.activeId).toBe(id('branch:x'));
    });

    it('closes a listed one the same way', () => {
      let s = syncTerminals(empty, [plain, inAlpha]);
      s = ended(s, plain.name);
      expect(s.tabs.map((t) => t.id)).toEqual([terminalTabId(inAlpha.name)]);
    });

    it('never hands focus to another repository', () => {
      let s = open(empty, 'branch:x');
      s = open(s, 'branch:y', false, OTHER);
      s = openTerminal(s, plain); // active, rightmost
      s = ended(s, plain.name);
      expect(s.activeId).toBe(id('branch:x'));
    });

    it('leaves every other tab exactly as it was', () => {
      let s = open(empty, 'branch:x');
      s = openTerminal(s, inAlpha);
      s = openTerminal(s, plain);
      const before = s.tabs.slice(0, 2);
      s = ended(s, plain.name);
      expect(s.tabs).toHaveLength(2);
      s.tabs.forEach((t, i) => expect(t).toBe(before[i]));
    });

    // A worktree agent's exit rides the same event; its name is no
    // terminal tab's, and nothing here may react to it.
    it('is a no-op for a name that has no terminal tab', () => {
      const s = open(openTerminal(empty, plain), 'branch:x');
      expect(ended(s, 'feat-x')).toBe(s);
      expect(ended(s, 'n10-shell-9')).toBe(s);
    });
  });

  // No listing is not an empty listing: before the host has answered,
  // or while a query has no data, there is nothing to reconcile
  // against, and closing every terminal tab on that tick would be
  // closing them on nothing.
  it('leaves every terminal tab alone when there is no listing', () => {
    const s = openTerminal(openTerminal(empty, plain), inAlpha);
    expect(sync(s, [], REPO, undefined)).toBe(s);
    expect(sync(s, [], OTHER, undefined)).toBe(s);
  });
});

// Quit with agents open in several repositories, relaunch, and every
// one is still running in tmux — the host attaches only the open
// repository's, but the strip spans repositories, so the others get
// their tabs back in their own groups from the host's wider listing.
describe('agents alive in other repositories', () => {
  const inBeta: ForeignSessionEntry = {
    repo: OTHER,
    branch: 'feat',
    sessionName: 'feat',
  };
  const foreign = (
    state: TabsState,
    entries: ForeignSessionEntry[] | undefined,
    repo = REPO
  ) =>
    reduce(state, { type: 'sync-items', repo, entries: [], foreign: entries });

  it('opens a pinned tab in that repository’s group without moving focus', () => {
    let s = open(empty, 'branch:x');
    s = foreign(s, [inBeta]);
    expect(s.tabs).toEqual([
      expect.objectContaining({ id: id('branch:x') }),
      expect.objectContaining({
        kind: 'item',
        repo: OTHER,
        itemKey: 'branch:feat',
        branch: 'feat',
        title: 'feat',
        preview: false,
      }),
    ]);
    expect(s.activeId).toBe(id('branch:x'));
    expect(activeTabRepo(s)).toBe(REPO);
  });

  // The repository in view describes its own agents through the
  // sidebar; a listing that names one of them is not this pass's word.
  it('never opens a tab for the repository in view', () => {
    const s = foreign(empty, [{ ...inBeta, repo: REPO }]);
    expect(s).toBe(empty);
  });

  it('does not reopen a tab the user closed while the agent runs on', () => {
    let s = foreign(empty, [inBeta]);
    s = reduce(s, { type: 'close', id: id('branch:feat', OTHER) });
    s = foreign(s, [inBeta]);
    expect(s.tabs).toEqual([]);
  });

  // Once the user switches there, that repository's own sync sees the
  // agent as newly running — and must find its tab already open rather
  // than opening (and focusing) a second one.
  it('is not opened again, or focused, by that repository’s own sync', () => {
    let s = open(empty, 'branch:x');
    s = foreign(s, [inBeta]);
    s = sync(
      s,
      [
        {
          itemKey: 'branch:feat',
          branch: 'feat',
          sessionName: 'feat',
          running: true,
        },
      ],
      OTHER
    );
    expect(
      s.tabs.filter((t) => t.kind === 'item' && t.repo === OTHER)
    ).toHaveLength(1);
    expect(s.activeId).toBe(id('branch:x'));
  });

  // A tab that repository re-keyed onto its pull request is the same
  // agent's tab; the listing, which only knows the branch, must
  // recognise it even once its auto-open history is forgotten.
  it('recognises a tab that was re-keyed onto a pull request', () => {
    let s = foreign(empty, [inBeta]);
    s = sync(s, [{ itemKey: 'pr:7', branch: 'feat' }], OTHER);
    s = reduce(s, {
      type: 'forget-auto-opened',
      keys: [autoOpenKey(OTHER, 'feat')],
    });
    s = foreign(s, [inBeta]);
    expect(s.tabs).toHaveLength(1);
    expect(s.tabs[0].kind === 'item' && s.tabs[0].itemKey).toBe('pr:7');
  });

  it('returns the same state when the listing changed nothing', () => {
    const s = foreign(empty, [inBeta]);
    expect(foreign(s, [inBeta])).toBe(s);
  });

  it('leaves every tab alone with no listing', () => {
    const s = open(empty, 'branch:x');
    expect(foreign(s, undefined)).toBe(s);
  });
});
