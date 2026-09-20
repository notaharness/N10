import { describe, expect, it } from 'vitest';
import type { DiffLine } from '@n10/diff';
import type {
  RemoteCommentThread,
  ReviewComment,
} from '../../../host/contract.js';
import {
  buildCommentRows,
  buildFileEntries,
  diffIsPending,
  groupDraftsByFile,
  groupThreadsByFile,
  navIndexOf,
  resolveMode,
  compareCommentRows,
  stepComment,
  unpostedDrafts,
  visibleComments,
  type CommentRow,
  type Mode,
} from './review-model.js';

/**
 * The review workspace's decisions, tested where they have actually
 * been wrong: which pane survives its precondition disappearing, and
 * what "the next comment" means once the list is filtered.
 */

// ── Fixtures ─────────────────────────────────────────────────────

function thread(o: Partial<RemoteCommentThread> = {}): RemoteCommentThread {
  return {
    id: 't1',
    file: 'src/a.ts',
    lineStart: 1,
    lineEnd: 1,
    side: 'RIGHT',
    isResolved: false,
    isOutdated: false,
    canResolve: true,
    comments: [
      {
        id: 'c1',
        author: 'ada',
        body: 'body',
        createdAt: '2024-01-01T00:00:00Z',
      },
    ],
    ...o,
  } as RemoteCommentThread;
}

function draft(o: Partial<ReviewComment> = {}): ReviewComment {
  return {
    id: 'd1',
    file: 'src/a.ts',
    lineStart: 1,
    lineEnd: 1,
    severity: 'minor',
    body: 'draft body',
    side: 'RIGHT',
    status: 'draft',
    createdAt: '2024-01-01T00:00:00Z',
    ...o,
  };
}

function line(type: DiffLine['type']): DiffLine {
  return { type, content: 'x', oldLine: 1, newLine: 1 } as DiffLine;
}

function files(...names: string[]): [string, DiffLine[]][] {
  return names.map((n) => [n, []]);
}

// ── resolveMode ──────────────────────────────────────────────────

describe('resolveMode', () => {
  const ALL: Mode[] = [
    'diff',
    'agent',
    'review',
    'overview',
    'plan',
    'session',
  ];
  const NOTHING = {
    hasSession: false,
    hasDrafts: false,
    hasPr: false,
    hasPlan: false,
    hasPickedSession: false,
  };
  const EVERYTHING = {
    hasSession: true,
    hasDrafts: true,
    hasPr: true,
    hasPlan: true,
    hasPickedSession: true,
  };

  it('keeps every mode when its own precondition holds', () => {
    expect(ALL.map((m) => resolveMode(m, EVERYTHING))).toEqual(ALL);
  });

  it('falls every mode back to the diff when nothing is available', () => {
    expect(ALL.map((m) => resolveMode(m, NOTHING))).toEqual(
      ALL.map(() => 'diff')
    );
  });

  /**
   * Each mode is gated on its own precondition and no other — the whole
   * grid, so a condition wired to the wrong flag shows up as a cell.
   */
  it('gates each mode on its own precondition only', () => {
    const grid = ALL.map((mode) => [
      resolveMode(mode, { ...NOTHING, hasSession: true }),
      resolveMode(mode, { ...NOTHING, hasDrafts: true }),
      resolveMode(mode, { ...NOTHING, hasPr: true }),
      resolveMode(mode, { ...NOTHING, hasPlan: true }),
      resolveMode(mode, { ...NOTHING, hasPickedSession: true }),
    ]);
    expect(grid).toEqual([
      // requested     agent   drafts    pr        plan    picked
      /* diff     */ ['diff', 'diff', 'diff', 'diff', 'diff'],
      /* agent    */ ['agent', 'diff', 'diff', 'diff', 'diff'],
      /* review   */ ['diff', 'review', 'diff', 'diff', 'diff'],
      /* overview */ ['diff', 'diff', 'overview', 'diff', 'diff'],
      /* plan     */ ['diff', 'diff', 'diff', 'plan', 'diff'],
      /* session  */ ['diff', 'diff', 'diff', 'diff', 'session'],
    ]);
  });

  it('does not let another mode’s precondition rescue the request', () => {
    // A PR whose last draft was just posted, while a session is alive:
    // the walkthrough is gone, and the answer is the diff — never the
    // agent, which the user did not ask for.
    expect(
      resolveMode('review', {
        hasSession: true,
        hasDrafts: false,
        hasPr: true,
        hasPlan: false,
        hasPickedSession: false,
      })
    ).toBe('diff');
  });

  /**
   * Emptying the cart while looking at it is the ordinary way out of
   * the plan pane — remove the last row and there is nothing left to
   * send. Stranding the user on an empty checkout screen was the bug
   * this covers; the TUI drops back the same way.
   */
  it('leaves the plan pane when its last item is removed', () => {
    expect(
      resolveMode('plan', {
        hasSession: true,
        hasDrafts: true,
        hasPr: true,
        hasPlan: false,
        hasPickedSession: false,
      })
    ).toBe('diff');
  });
});

// ── diffIsPending ────────────────────────────────────────────────

describe('diffIsPending', () => {
  it('is pending while the patch itself is in flight', () => {
    expect(diffIsPending(true, undefined, undefined)).toBe(true);
  });

  /** The case the second clause exists for: the patch has landed and
   *  the worker has not produced a parse for *this* patch yet. */
  it('is pending when a patch has arrived but its parse has not', () => {
    expect(diffIsPending(false, 'diff --git a/x b/x', undefined)).toBe(true);
  });

  /** And the case that stops it being "pending forever": a query that
   *  is disabled/idle has no patch and no parse, and is not loading. */
  it('is not pending when there is no patch and nothing is loading', () => {
    expect(diffIsPending(false, undefined, undefined)).toBe(false);
  });

  it('is not pending once the parse matches the patch', () => {
    expect(diffIsPending(false, 'patch', [])).toBe(false);
  });
});

// ── drafts ───────────────────────────────────────────────────────

describe('unpostedDrafts', () => {
  it('keeps drafts that are mid-post, and drops only posted ones', () => {
    const all = [
      draft({ id: 'a', status: 'draft' }),
      draft({ id: 'b', status: 'posting' }),
      draft({ id: 'c', status: 'posted' }),
    ];
    expect(unpostedDrafts(all).map((d) => d.id)).toEqual(['a', 'b']);
  });
});

// ── grouping ─────────────────────────────────────────────────────

describe('groupThreadsByFile', () => {
  it('drops general (file-less) threads instead of keying them', () => {
    const map = groupThreadsByFile([
      thread({ id: 'inline', file: 'src/a.ts' }),
      thread({ id: 'general', file: null }),
    ]);
    expect([...map.keys()]).toEqual(['src/a.ts']);
    expect(map.get('src/a.ts')!.map((t) => t.id)).toEqual(['inline']);
  });

  it('collects every thread on a file, in input order', () => {
    const map = groupThreadsByFile([
      thread({ id: '1', file: 'a' }),
      thread({ id: '2', file: 'b' }),
      thread({ id: '3', file: 'a' }),
    ]);
    expect(map.get('a')!.map((t) => t.id)).toEqual(['1', '3']);
    expect(map.get('b')!.map((t) => t.id)).toEqual(['2']);
  });
});

describe('groupDraftsByFile', () => {
  it('collects every draft on a file, in input order', () => {
    const map = groupDraftsByFile([
      draft({ id: '1', file: 'a' }),
      draft({ id: '2', file: 'b' }),
      draft({ id: '3', file: 'a' }),
    ]);
    expect(map.get('a')!.map((d) => d.id)).toEqual(['1', '3']);
    expect(map.get('b')!.map((d) => d.id)).toEqual(['2']);
  });
});

// ── file entries ─────────────────────────────────────────────────

describe('buildFileEntries', () => {
  const diffed: [string, DiffLine[]][] = [
    ['src/a.ts', [line('add'), line('add'), line('remove'), line('context')]],
    ['src/b.ts', [line('hunk-header'), line('context')]],
  ];

  it('counts only added and removed lines as churn', () => {
    const [a, b] = buildFileEntries(diffed, new Map(), new Map());
    expect(a).toMatchObject({ additions: 2, deletions: 1 });
    expect(b).toMatchObject({ additions: 0, deletions: 0 });
  });

  it('counts open threads only, and every draft', () => {
    const threads = groupThreadsByFile([
      thread({ id: '1', file: 'src/a.ts', isResolved: false }),
      thread({ id: '2', file: 'src/a.ts', isResolved: true }),
    ]);
    const drafts = groupDraftsByFile([
      draft({ id: 'd1', file: 'src/a.ts' }),
      draft({ id: 'd2', file: 'src/a.ts' }),
    ]);
    const [a, b] = buildFileEntries(diffed, threads, drafts);
    expect(a).toMatchObject({ comments: 1, drafts: 2 });
    expect(b).toMatchObject({ comments: 0, drafts: 0 });
  });

  it('keeps the diff’s file order', () => {
    expect(
      buildFileEntries(diffed, new Map(), new Map()).map((e) => e.path)
    ).toEqual(['src/a.ts', 'src/b.ts']);
  });

  // `revision` is what the file tree's collapse rule compares two polls
  // by (see lib/diff/file-tree-model.ts). A key that does not move when
  // the file does means the folder never opens; a key that moves when
  // the file has not means the tree reopens on every poll.
  describe('revision', () => {
    const of = (lines: DiffLine[]) =>
      buildFileEntries([['f.ts', lines]], new Map(), new Map())[0].revision;
    const text = (type: DiffLine['type'], content: string): DiffLine =>
      ({ type, content, oldLine: 1, newLine: 1 } as DiffLine);

    it('is stable for the same changed lines', () => {
      expect(of([text('add', 'one'), text('remove', 'two')])).toBe(
        of([text('add', 'one'), text('remove', 'two')])
      );
    });

    it('moves when a changed line is swapped for another of the same shape', () => {
      // The counts are identical here, which is exactly why churn
      // counts alone are not enough to detect the edit.
      expect(of([text('add', 'one')])).not.toBe(of([text('add', 'two')]));
    });

    it('moves when an addition becomes a removal', () => {
      expect(of([text('add', 'one')])).not.toBe(of([text('remove', 'one')]));
    });

    it('ignores context, which with -U99999 is the rest of the file', () => {
      expect(of([text('add', 'one'), text('context', 'noise')])).toBe(
        of([text('add', 'one'), text('context', 'different noise')])
      );
    });
  });
});

// ── the unified comment list ─────────────────────────────────────

describe('buildCommentRows ordering', () => {
  /**
   * File position, not the file name and not the line number: the diff
   * lists zeta before alpha, and the comment on zeta is on a later line
   * than the one on alpha. Only "rank in the diff" gets this order.
   */
  it('orders inline rows by the file’s position in the diff', () => {
    const rows = buildCommentRows(
      files('src/zeta.ts', 'src/alpha.ts'),
      [],
      [
        thread({ id: 'alpha', file: 'src/alpha.ts', lineStart: 1 }),
        thread({ id: 'zeta', file: 'src/zeta.ts', lineStart: 90 }),
      ],
      []
    );
    expect(rows.map((r) => r.id)).toEqual(['zeta', 'alpha']);
  });

  it('orders rows within a file by line', () => {
    const rows = buildCommentRows(
      files('src/a.ts'),
      [],
      [
        thread({ id: 'late', lineStart: 40 }),
        thread({ id: 'early', lineStart: 4 }),
      ],
      []
    );
    expect(rows.map((r) => r.id)).toEqual(['early', 'late']);
  });

  it('puts general comments ahead of every file comment', () => {
    const rows = buildCommentRows(
      files('src/a.ts'),
      [thread({ id: 'general', file: null })],
      [thread({ id: 'inline', lineStart: 1 })],
      [draft({ id: 'draft', lineStart: 1 })]
    );
    expect(rows[0].id).toBe('general');
    expect(rows[0].file).toBeNull();
  });

  /** A comment on a file the diff does not contain has no rank; it goes
   *  last rather than to the top, which `?? 0` would have done. */
  it('sorts comments on files outside the diff after every diffed file', () => {
    const rows = buildCommentRows(
      files('src/a.ts'),
      [],
      [
        thread({ id: 'ghost', file: 'src/gone.ts', lineStart: 1 }),
        thread({ id: 'known', file: 'src/a.ts', lineStart: 999 }),
      ],
      []
    );
    expect(rows.map((r) => r.id)).toEqual(['known', 'ghost']);
  });

  /** Threads and drafts tie on (file, line); the sort is stable and the
   *  rows are pushed threads-first, so the remote comment leads. */
  it('keeps the remote thread ahead of a draft on the same line', () => {
    const rows = buildCommentRows(
      files('src/a.ts'),
      [],
      [thread({ id: 'remote', lineStart: 7 })],
      [draft({ id: 'agent', lineStart: 7 })]
    );
    expect(rows.map((r) => r.id)).toEqual(['remote', 'agent']);
  });

  it('interleaves drafts and threads by line within a file', () => {
    const rows = buildCommentRows(
      files('src/a.ts'),
      [],
      [
        thread({ id: 't5', lineStart: 5 }),
        thread({ id: 't20', lineStart: 20 }),
      ],
      [draft({ id: 'd10', lineStart: 10 })]
    );
    expect(rows.map((r) => r.id)).toEqual(['t5', 'd10', 't20']);
  });
});

describe('buildCommentRows row contents', () => {
  it('labels a general comment Conversation and takes its root author', () => {
    const [row] = buildCommentRows(
      [],
      [
        thread({
          id: 'g',
          file: null,
          comments: [
            {
              id: 'c',
              author: 'grace',
              body: 'ship it',
              createdAt: '2024-01-01T00:00:00Z',
            },
            {
              id: 'c2',
              author: 'ada',
              body: 'later',
              createdAt: '2024-01-02T00:00:00Z',
            },
          ],
        } as Partial<RemoteCommentThread>),
      ],
      [],
      []
    );
    expect(row).toMatchObject({
      kind: 'thread',
      author: 'grace',
      where: 'Conversation',
      preview: 'ship it',
      line: 0,
      fileRank: -1,
    });
  });

  /**
   * The rail has one line to say what a comment is about. A
   * Conventional Comments header is already drawn as a badge on the
   * card, so repeating "issue (blocking):" here says nothing new and
   * pushes out the part that identifies which comment this is; the
   * signature goes for the same reason, since every agent comment ends
   * with the same words.
   */
  it('previews the prose, not the header or the signature', () => {
    const [row] = buildCommentRows(
      [],
      [
        thread({
          id: 'g',
          file: null,
          comments: [
            {
              id: 'c',
              author: 'grace',
              body:
                'issue (blocking): The undo stack is never bounded.\n\n' +
                'Nothing ever pops.\n\n---\n' +
                '_Posted via [n10](https://github.com/notaharness/n10) by an agent_',
              createdAt: '2024-01-01T00:00:00Z',
            },
          ],
        } as Partial<RemoteCommentThread>),
      ],
      [],
      []
    );
    expect(row.preview).toBe(
      'The undo stack is never bounded.\n\nNothing ever pops.'
    );
  });

  /** Most comments on a pull request are people's, written however
   *  they like, and must reach the rail exactly as typed. */
  it('leaves an ordinary comment as its own preview', () => {
    const [row] = buildCommentRows(
      [],
      [
        thread({
          id: 'g',
          file: null,
          comments: [
            {
              id: 'c',
              author: 'grace',
              body: 'note this: it looks fine',
              createdAt: '2024-01-01T00:00:00Z',
            },
          ],
        } as Partial<RemoteCommentThread>),
      ],
      [],
      []
    );
    expect(row.preview).toBe('note this: it looks fine');
  });

  it('survives a thread with no comments at all', () => {
    const [row] = buildCommentRows(
      [],
      [thread({ id: 'empty', file: null, comments: [] })],
      [],
      []
    );
    expect(row).toMatchObject({ author: '', preview: '' });
  });

  it('shows an inline thread as basename:line, not the full path', () => {
    const [row] = buildCommentRows(
      files('src/deep/nested/a.ts'),
      [],
      [thread({ file: 'src/deep/nested/a.ts', lineStart: 12 })],
      []
    );
    expect(row.where).toBe('a.ts:12');
    expect(row.line).toBe(12);
  });

  it('omits the line from a thread that has none, and ranks it at 0', () => {
    const [row] = buildCommentRows(
      files('src/a.ts'),
      [],
      [thread({ file: 'src/a.ts', lineStart: null })],
      []
    );
    expect(row.where).toBe('a.ts');
    expect(row.line).toBe(0);
  });

  it('carries a draft’s severity through, and never marks it resolved', () => {
    const [row] = buildCommentRows(
      files('src/a.ts'),
      [],
      [],
      [draft({ file: 'src/a.ts', lineStart: 3, severity: 'critical' })]
    );
    expect(row).toMatchObject({
      kind: 'draft',
      author: 'Draft',
      where: 'a.ts:3',
      severity: 'critical',
      resolved: false,
    });
  });

  it('reports a thread’s resolved state', () => {
    const rows = buildCommentRows(
      files('src/a.ts'),
      [],
      [
        thread({ id: 'open', lineStart: 1, isResolved: false }),
        thread({ id: 'done', lineStart: 2, isResolved: true }),
      ],
      []
    );
    expect(rows.map((r) => r.resolved)).toEqual([false, true]);
  });
});

// ── filtering and navigation ─────────────────────────────────────

function rows(...specs: [string, boolean][]): CommentRow[] {
  return specs.map(([id, resolved], i) => ({
    id,
    kind: 'thread',
    author: 'a',
    where: 'w',
    preview: 'p',
    resolved,
    file: 'src/a.ts',
    line: i,
    fileRank: 0,
  }));
}

describe('compareCommentRows', () => {
  /**
   * Having no file is the primary key, ahead of the rank. Rows built by
   * `buildCommentRows` never exercise this on their own — it gives
   * general rows `fileRank: -1`, which already sorts them first — but
   * the comparator is what any other caller gets, and "file-less first"
   * is the rule it states.
   */
  it('puts a file-less row first even when it outranks nothing', () => {
    const [general, filed] = rows(['g', false], ['f', false]);
    const a: CommentRow = { ...general, file: null, fileRank: 9, line: 500 };
    const b: CommentRow = { ...filed, file: 'src/a.ts', fileRank: 0, line: 1 };
    expect(compareCommentRows(a, b)).toBeLessThan(0);
    expect(compareCommentRows(b, a)).toBeGreaterThan(0);
  });

  it('ties rows that agree on file-ness, rank and line', () => {
    const [a, b] = rows(['a', false], ['b', false]);
    expect(compareCommentRows(a, { ...b, line: a.line })).toBe(0);
  });
});

describe('visibleComments', () => {
  it('returns the same array when nothing is hidden', () => {
    const all = rows(['a', false], ['b', true]);
    // Identity, not equality: the full list is memoized and its
    // consumers are keyed on that identity.
    expect(visibleComments(all, false)).toBe(all);
  });

  it('drops resolved rows and keeps the rest in order', () => {
    const all = rows(['a', false], ['b', true], ['c', false]);
    expect(visibleComments(all, true).map((r) => r.id)).toEqual(['a', 'c']);
  });
});

describe('navIndexOf', () => {
  it('finds the focused row', () => {
    expect(navIndexOf(rows(['a', false], ['b', false]), 'b')).toBe(1);
  });

  it('reports -1 for nothing focused, and for a row that is filtered out', () => {
    const all = rows(['a', false], ['resolved', true]);
    expect(navIndexOf(all, null)).toBe(-1);
    expect(navIndexOf(visibleComments(all, true), 'resolved')).toBe(-1);
  });
});

describe('stepComment', () => {
  const three = rows(['a', false], ['b', false], ['c', false]);

  it('has nowhere to go in an empty list', () => {
    expect(stepComment([], -1, 1)).toBeNull();
    expect(stepComment([], 0, 1)).toBeNull();
  });

  it('moves to the neighbour', () => {
    expect(stepComment(three, 0, 1)!.id).toBe('b');
    expect(stepComment(three, 2, -1)!.id).toBe('b');
  });

  it('wraps past the end and before the start', () => {
    expect(stepComment(three, 2, 1)!.id).toBe('a');
    expect(stepComment(three, 0, -1)!.id).toBe('c');
  });

  /**
   * CURRENT BEHAVIOUR, pinned rather than endorsed. With nothing
   * focused, *both* directions land on the first comment — "previous"
   * does not open at the end of the list.
   */
  it('starts at the first comment in either direction when nothing is focused', () => {
    expect(stepComment(three, -1, 1)!.id).toBe('a');
    expect(stepComment(three, -1, -1)!.id).toBe('a');
  });

  /**
   * CURRENT BEHAVIOUR, and the reason the case above matters. The user
   * is on the second of three comments, that one is resolved, and they
   * turn on hide-resolved: the focused row leaves the list, `navIndex`
   * goes to -1, and the next "next" jumps back to the top instead of
   * continuing to the comment after the one they were on.
   */
  it('restarts at the top after hide-resolved removes the focused row', () => {
    const all = rows(['a', false], ['focused', true], ['c', false]);
    const visible = visibleComments(all, true);
    const index = navIndexOf(visible, 'focused');
    expect(index).toBe(-1);
    expect(stepComment(visible, index, 1)!.id).toBe('a');
  });
});
