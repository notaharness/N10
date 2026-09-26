import { describe, it, expect } from 'vitest';
import type { CategorizedReviews, PullRequestInfo } from '@n10/vcs-core';
import type { SidebarItem, AgentSession } from '@n10/core';
import type { SidebarSelection } from './SidebarContext.js';
import {
  INITIAL_SELECTION,
  reconcileSelection,
  resolveSelectedIndex,
  selectionForKey,
  translateSelectKey,
  anchorSelection,
} from './SidebarContext.js';

function session(name: string): SidebarItem {
  const s: AgentSession = { name, running: false };
  return { kind: 'session', session: s, isMerged: false };
}

function makePr(id: number, sourceBranch: string): PullRequestInfo {
  return {
    id,
    sourceBranch,
    targetBranch: 'main',
    title: `PR #${id}`,
    isDraft: false,
    createdByIdentifier: 'someone',
    url: `https://example.com/pr/${id}`,
  } as unknown as PullRequestInfo;
}

function makeCr(parts: Partial<CategorizedReviews> = {}): CategorizedReviews {
  return {
    needsReview: parts.needsReview ?? [],
    waitingForAuthor: parts.waitingForAuthor ?? [],
    approvedByYou: parts.approvedByYou ?? [],
  };
}

describe('resolveSelectedIndex', () => {
  it('returns 0 when the list is empty', () => {
    expect(resolveSelectedIndex([], null, 0)).toBe(0);
    expect(resolveSelectedIndex([], 'session:foo', 5)).toBe(0);
  });

  it('returns 0 when selectedKey is null', () => {
    const items = [session('a'), session('b'), session('c')];
    expect(resolveSelectedIndex(items, null, 2)).toBe(0);
  });

  it('follows the selected item across a reorder', () => {
    const before = [session('a'), session('b'), session('c')];
    expect(resolveSelectedIndex(before, 'session:b', 0)).toBe(1);

    const after = [session('c'), session('b'), session('a')];
    expect(resolveSelectedIndex(after, 'session:b', 1)).toBe(1);

    const swapped = [session('b'), session('a'), session('c')];
    expect(resolveSelectedIndex(swapped, 'session:b', 1)).toBe(0);
  });

  it('falls back to lastValidIndex when the selected item was removed', () => {
    const before = [session('a'), session('b'), session('c')];
    expect(resolveSelectedIndex(before, 'session:b', 0)).toBe(1);

    // 'b' is gone → lastValidIndex (1) maps to current items[1] = 'c'.
    const after = [session('a'), session('c')];
    expect(resolveSelectedIndex(after, 'session:b', 1)).toBe(1);
  });

  it('clamps the fallback to the new list length', () => {
    const before = [session('a'), session('b'), session('c')];
    // Selected the last row, then that row and the two before it get
    // deleted, leaving only one item.
    expect(resolveSelectedIndex(before, 'session:c', 2)).toBe(2);

    const after = [session('a')];
    expect(resolveSelectedIndex(after, 'session:c', 2)).toBe(0);
  });

  it('clamps negative lastValidIndex to 0', () => {
    const items = [session('a'), session('b')];
    // Fallback path (missing key) with an unexpected negative fallback
    // still produces a valid index — guards against ref drift.
    expect(resolveSelectedIndex(items, 'session:missing', -3)).toBe(0);
  });

  it('returns 0 when the key matches no item and lastValidIndex is 0', () => {
    const items = [session('a'), session('b')];
    expect(resolveSelectedIndex(items, 'session:missing', 0)).toBe(0);
  });
});

/**
 * The provider's render loop, minus React: it re-anchors the selection
 * every time the `items` array changes identity, and navigation writes
 * an already-resolved anchor between those changes. Sequencing these
 * calls is what the tests below are really exercising — a single
 * `reconcileSelection` call in isolation says very little.
 */
function rerenderWith(
  selection: SidebarSelection,
  items: SidebarItem[]
): SidebarSelection {
  return reconcileSelection(items, selection);
}

describe('sidebar selection across list changes', () => {
  it('starts on the first row once items arrive', () => {
    // Mount renders an empty sidebar; sessions land a tick later.
    let sel = rerenderWith(INITIAL_SELECTION, []);
    expect(sel).toEqual({ key: null, index: 0 });

    sel = rerenderWith(sel, [session('a'), session('b')]);
    expect(sel).toEqual({ key: 'session:a', index: 0 });
  });

  it('keeps the cursor on the selected row through a re-sort', () => {
    const items = [session('a'), session('b'), session('c')];
    let sel = selectionForKey(items, 'session:c', INITIAL_SELECTION);
    expect(sel.index).toBe(2);

    // Sessions re-sort on activity; the cursor follows its row.
    sel = rerenderWith(sel, [session('c'), session('a'), session('b')]);
    expect(sel).toEqual({ key: 'session:c', index: 0 });
  });

  it('adopts the row that replaced a deleted one, and then follows it', () => {
    const items = [session('a'), session('b'), session('c')];
    let sel = selectionForKey(items, 'session:b', INITIAL_SELECTION);
    expect(sel.index).toBe(1);

    // 'b' is deleted — the cursor stays put, so it now sits on 'c'.
    sel = rerenderWith(sel, [session('a'), session('c')]);
    expect(sel).toEqual({ key: 'session:c', index: 1 });

    // A later re-sort must move with 'c', not sit on index 1. This is
    // the whole point of adopting: without it the anchor is still the
    // deleted 'b' and the cursor would land on 'a'.
    sel = rerenderWith(sel, [session('c'), session('a')]);
    expect(sel).toEqual({ key: 'session:c', index: 0 });
  });

  it('re-resolves without allocating when nothing moved', () => {
    // The provider sets state during render; a `reconcileSelection`
    // that always returned a fresh object would loop forever.
    const items = [session('a'), session('b')];
    const sel = rerenderWith(INITIAL_SELECTION, items);
    expect(rerenderWith(sel, [...items])).toBe(sel);
  });
});

describe('selectionForKey', () => {
  it('moves the cursor to the row that owns the key', () => {
    const items = [session('a'), session('b'), session('c')];
    const sel = selectionForKey(items, 'session:c', {
      key: 'session:a',
      index: 0,
    });
    expect(sel).toEqual({ key: 'session:c', index: 2 });
  });

  it('holds the cursor still for a row that has not appeared yet', () => {
    // The branch picker selects a session the instant it is created,
    // before the sidebar has refreshed. The cursor must not jump to
    // the top of the list while it waits.
    const items = [session('a'), session('b')];
    const sel = selectionForKey(items, 'session:brand-new', {
      key: 'session:b',
      index: 1,
    });
    expect(sel.index).toBe(1);

    // …and takes the row as soon as the refresh brings it in.
    const after = rerenderWith(sel, [
      session('a'),
      session('b'),
      session('brand-new'),
    ]);
    expect(after).toEqual({ key: 'session:brand-new', index: 2 });
  });
});

describe('translateSelectKey', () => {
  const worktree = (name: string, branch: string): AgentSession => ({
    name,
    running: false,
    branch,
  });

  it('returns non-session keys unchanged', () => {
    const cr = makeCr();
    expect(translateSelectKey('review:42', [], cr)).toBe('review:42');
    expect(translateSelectKey('orphan:7', [], cr)).toBe('orphan:7');
  });

  it('returns session keys unchanged when the session has no PR', () => {
    const cr = makeCr();
    const sessions = [worktree('my-feature', 'feature/my-feature')];
    expect(translateSelectKey('session:my-feature', sessions, cr)).toBe(
      'session:my-feature'
    );
  });

  it('returns session keys unchanged when the PR is non-review (orphan/active by user)', () => {
    // Author-side PR (#99 on feature/mine): the session row is rendered
    // as `kind: 'session'` (active-pr section), so the key is not in any
    // review category and selectByKey('session:foo') matches the session
    // row directly — no translation needed.
    const sessions = [worktree('feature-mine', 'feature/mine')];
    const cr = makeCr(); // PR is NOT in any review category
    expect(translateSelectKey('session:feature-mine', sessions, cr)).toBe(
      'session:feature-mine'
    );
  });

  it('translates from the branch alone, before the session has PR data', () => {
    // Right after a worktree is created for a PR branch, the session is
    // listed with its branch but its PR data has not resolved yet — the row
    // is already folded into the review PR, so the key must follow.
    const cr = {
      needsReview: [{ id: 42, sourceBranch: 'feat/x' } as PullRequestInfo],
      waitingForAuthor: [],
      approvedByYou: [],
    };
    expect(
      translateSelectKey('session:feat-x', [worktree('feat-x', 'feat/x')], cr)
    ).toBe('review:42');
  });

  it('translates to review:${prId} when the branch is in needsReview', () => {
    const pr = makePr(38, 'fixture/add-undo-feature');
    const sessions = [
      worktree('fixture-add-undo-feature', 'fixture/add-undo-feature'),
    ];
    const cr = makeCr({ needsReview: [pr] });
    expect(
      translateSelectKey('session:fixture-add-undo-feature', sessions, cr)
    ).toBe('review:38');
  });

  it('translates to review:${prId} when the branch is in waitingForAuthor', () => {
    const pr = makePr(38, 'fixture/add-undo-feature');
    const sessions = [
      worktree('fixture-add-undo-feature', 'fixture/add-undo-feature'),
    ];
    const cr = makeCr({ waitingForAuthor: [pr] });
    expect(
      translateSelectKey('session:fixture-add-undo-feature', sessions, cr)
    ).toBe('review:38');
  });

  it('translates to review:${prId} when the branch is in approvedByYou', () => {
    const pr = makePr(37, 'fixture/add-color-support');
    const sessions = [
      worktree('fixture-add-color-support', 'fixture/add-color-support'),
    ];
    const cr = makeCr({ approvedByYou: [pr] });
    expect(
      translateSelectKey('session:fixture-add-color-support', sessions, cr)
    ).toBe('review:37');
  });
});

describe('anchorSelection', () => {
  const session = (name: string): SidebarItem =>
    ({ kind: 'session', session: { name, running: false } } as SidebarItem);
  const review = (id: number): SidebarItem =>
    ({ kind: 'review-pr', pr: makePr(id, 'feat/x') } as SidebarItem);

  it('lands on the translated row when the list and the key change together', () => {
    // The branch picker: refreshSessions publishes a list in which the
    // new session is folded into its review row, and in the same render
    // selectByKey('session:feat-x') arrives. The translated key has to
    // be what gets reconciled — reconciling the raw key would miss,
    // adopt the neighbour and overwrite the request.
    const after = [session('alpha'), review(42), session('beta')];
    const selection = { key: 'session:feat-x', index: 0 };
    expect(anchorSelection(after, selection, 'review:42', true)).toEqual({
      key: 'review:42',
      index: 1,
    });
  });

  it('resolves a translated key against an unchanged list', () => {
    const items = [session('alpha'), review(42)];
    expect(
      anchorSelection(
        items,
        { key: 'session:feat-x', index: 0 },
        'review:42',
        false
      )
    ).toEqual({ key: 'review:42', index: 1 });
  });

  it('keeps an untranslated key that is not in the list yet', () => {
    const items = [session('alpha')];
    const selection = { key: 'session:feat-x', index: 0 };
    expect(anchorSelection(items, selection, 'session:feat-x', false)).toEqual(
      selection
    );
  });
});
