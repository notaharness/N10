import type { DiffLine } from '@n10/diff';
import { commentBodyParts } from '@n10/review-comments/conventional';
import type {
  RemoteCommentThread,
  ReviewComment,
} from '../../../host/contract.js';
import type { CommentListItem } from '../../components/review/comments/CommentsList.js';
import { contentKey } from '../content-key.js';
import type { FileEntry } from '../../components/review/diff/FileTree.js';

/**
 * The decisions the PR review workspace makes about *what to show*,
 * separated from the component that shows it. Everything here is a
 * function of the queried data plus the pane's own state — no DOM, no
 * hooks — so the ordering, the fallbacks and the comment navigator can
 * be tested for the cases that have actually broken.
 */

/** Which pane of the review workspace is showing. */
export type Mode =
  | 'diff'
  | 'agent'
  | 'review'
  | 'overview'
  | 'plan'
  /** One of the worktree's other live sessions — a reviewer, a shell. */
  | 'session';

/** What each mode needs in order to be showable at all. */
export interface ModeContext {
  /** A PTY session exists for this branch (running or its last frame). */
  hasSession: boolean;
  /** At least one unposted agent draft. */
  hasDrafts: boolean;
  /** The tab is a pull request, not a bare worktree. */
  hasPr: boolean;
  /** At least one comment queued in this PR's plan. */
  hasPlan: boolean;
  /** The picked session still exists — see `worktree-sessions.ts`. */
  hasPickedSession: boolean;
}

/**
 * The pane actually rendered. A mode is a *request*: the agent pane
 * needs a session, the walkthrough needs drafts, the overview needs a
 * PR and the plan needs something in it, and any of those can disappear
 * underneath a mode that is already selected (the last draft gets
 * posted, a session is stopped and removed, the last queued comment is
 * dropped). Rather than reset the request, every mode falls back
 * to the diff, which is the one pane that is always available — so
 * when the precondition comes back, so does the pane.
 */
export function resolveMode(mode: Mode, ctx: ModeContext): Mode {
  if (mode === 'agent' && ctx.hasSession) return 'agent';
  if (mode === 'review' && ctx.hasDrafts) return 'review';
  if (mode === 'overview' && ctx.hasPr) return 'overview';
  if (mode === 'plan' && ctx.hasPlan) return 'plan';
  if (mode === 'session' && ctx.hasPickedSession) return 'session';
  return 'diff';
}

/**
 * Whether the viewer should show its loading state: either the patch
 * itself is still in flight, or a patch has arrived and the worker has
 * not finished parsing *that* patch yet. The parse query is keyed on
 * the patch content, so while a newer patch is parsing there is no data
 * for its key — without the second clause the viewer would report "no
 * files" for the new patch instead of "still working".
 */
export function diffIsPending(
  isLoading: boolean,
  patch: string | undefined,
  parsed: [string, DiffLine[]][] | undefined
): boolean {
  return isLoading || (patch != null && parsed === undefined);
}

/** Drafts the agent has written but not yet posted. */
export function unpostedDrafts(
  drafts: readonly ReviewComment[]
): ReviewComment[] {
  return drafts.filter((d) => d.status !== 'posted');
}

export function groupDraftsByFile(
  drafts: readonly ReviewComment[]
): Map<string, ReviewComment[]> {
  const map = new Map<string, ReviewComment[]>();
  for (const d of drafts)
    (map.get(d.file) ?? map.set(d.file, []).get(d.file)!).push(d);
  return map;
}

/** Inline threads keyed by file; general (file-less) threads drop out. */
export function groupThreadsByFile(
  threads: readonly RemoteCommentThread[]
): Map<string, RemoteCommentThread[]> {
  const map = new Map<string, RemoteCommentThread[]>();
  for (const t of threads) {
    if (t.file == null) continue;
    (map.get(t.file) ?? map.set(t.file, []).get(t.file)!).push(t);
  }
  return map;
}

/**
 * A file's changed content, as a short key.
 *
 * The tree's collapse rule needs to know which files a refresh actually
 * touched, and churn counts are not enough on their own — swapping one
 * line for another leaves both of them where they were. Only the added
 * and removed lines go in: with `-U99999` the rest of `lines` is the
 * whole file as context, and hashing that on every two-second poll of a
 * megabyte diff is work for nothing.
 */
function fileRevision(lines: readonly DiffLine[]): string {
  let changed = '';
  for (const line of lines) {
    if (line.type === 'add' || line.type === 'remove') {
      changed += `${line.type}${line.content}\n`;
    }
  }
  return contentKey(changed);
}

/** File-tree rows: per-file churn, open threads and draft counts. */
export function buildFileEntries(
  files: readonly [string, DiffLine[]][],
  threadsByFile: Map<string, RemoteCommentThread[]>,
  draftsByFile: Map<string, ReviewComment[]>
): FileEntry[] {
  return files.map(([filename, lines]) => ({
    path: filename,
    revision: fileRevision(lines),
    additions: lines.filter((l) => l.type === 'add').length,
    deletions: lines.filter((l) => l.type === 'remove').length,
    comments: (threadsByFile.get(filename) ?? []).filter((t) => !t.isResolved)
      .length,
    drafts: (draftsByFile.get(filename) ?? []).length,
  }));
}

// ── The unified comment list ─────────────────────────────────────

/**
 * A `CommentListItem` plus where it sits in the document, which is what
 * orders the list and what the diff pane needs in order to scroll to
 * it. The extra fields are carried on the same row rather than in a
 * side table so a row can never be separated from its anchor.
 */
export interface CommentRow extends CommentListItem {
  /** null for general PR comments, which belong to no file. */
  file: string | null;
  line: number;
  /** Position of `file` among the diffed files; files that are not in
   *  the diff sort last. */
  fileRank: number;
}

/**
 * Every comment on the PR as one document-ordered list: general
 * (Conversation) comments first, then per file the remote threads and
 * the agent's drafts interleaved by line. Both the rail's Comments list
 * and the diff toolbar's prev/next walk this list, which is why it has
 * to be one list — they used to disagree about what "the next comment"
 * meant.
 *
 * The sort is by (has-a-file, file position, line) and nothing else, so
 * it is deliberately not a total order: a thread and a draft on the
 * same line compare equal and `Array.sort`'s stability leaves them in
 * insertion order — remote threads before drafts.
 */
export function buildCommentRows(
  files: readonly [string, DiffLine[]][],
  general: readonly RemoteCommentThread[],
  inlineThreads: readonly RemoteCommentThread[],
  drafts: readonly ReviewComment[]
): CommentRow[] {
  const order = new Map(files.map(([f], i) => [f, i]));
  const rows: CommentRow[] = [];
  for (const t of general) rows.push(generalRow(t));
  for (const t of inlineThreads) rows.push(inlineRow(t, order));
  for (const d of drafts) rows.push(draftRow(d, order));
  rows.sort(compareCommentRows);
  return rows;
}

/**
 * The one line the rail has to say what a comment is about.
 *
 * A Conventional Comments header is drawn as a badge on the card, so
 * spending the rail's only line repeating "issue (blocking):" says
 * nothing the reader cannot already see and pushes out the part that
 * identifies which comment this is. The signature goes for the same
 * reason: every agent comment ends with the same words.
 */
function commentPreview(body: string): string {
  return commentBodyParts(body).body;
}

/** A general PR comment: no file, and ahead of every inline row. */
function generalRow(t: RemoteCommentThread): CommentRow {
  const root = t.comments[0];
  return {
    id: t.id,
    kind: 'thread',
    author: root?.author ?? '',
    where: 'Conversation',
    preview: commentPreview(root?.body ?? ''),
    resolved: t.isResolved,
    file: null,
    line: 0,
    fileRank: -1,
  };
}

function inlineRow(
  t: RemoteCommentThread,
  order: Map<string, number>
): CommentRow {
  const root = t.comments[0];
  return {
    id: t.id,
    kind: 'thread',
    author: root?.author ?? '',
    where: `${t.file?.split('/').pop() ?? ''}${
      t.lineStart != null ? `:${t.lineStart}` : ''
    }`,
    preview: commentPreview(root?.body ?? ''),
    resolved: t.isResolved,
    file: t.file,
    line: t.lineStart ?? 0,
    fileRank: order.get(t.file ?? '') ?? Number.MAX_SAFE_INTEGER,
  };
}

function draftRow(d: ReviewComment, order: Map<string, number>): CommentRow {
  return {
    id: d.id,
    kind: 'draft',
    author: 'Draft',
    where: `${d.file.split('/').pop()}:${d.lineStart}`,
    preview: commentPreview(d.body),
    resolved: false,
    severity: d.severity,
    file: d.file,
    line: d.lineStart,
    fileRank: order.get(d.file) ?? Number.MAX_SAFE_INTEGER,
  };
}

/**
 * Document order: file-less (general) rows first, then by the file's
 * position in the diff, then by line. Equal on all three — a thread and
 * a draft on the same line — and `Array.sort`'s stability decides,
 * which is why the rows are pushed threads-before-drafts.
 */
export function compareCommentRows(a: CommentRow, b: CommentRow): number {
  const ga = a.file == null ? 0 : 1;
  const gb = b.file == null ? 0 : 1;
  if (ga !== gb) return ga - gb;
  if (a.fileRank !== b.fileRank) return a.fileRank - b.fileRank;
  return a.line - b.line;
}

/**
 * The one list everything that walks comments sees. Listing a resolved
 * thread in the rail while the diff hides it — and letting prev/next
 * jump to a row that is not rendered — was the inconsistency here, so
 * the filter happens once and both readers take the result.
 *
 * Returns the input array unchanged when nothing is hidden, so the
 * memoized identity of the full list survives.
 */
export function visibleComments(
  rows: CommentRow[],
  hideResolved: boolean
): CommentRow[] {
  return hideResolved ? rows.filter((r) => !r.resolved) : rows;
}

/** Position of the focused comment in the visible list, or -1. */
export function navIndexOf(
  rows: readonly CommentRow[],
  focusId: string | null
): number {
  return rows.findIndex((r) => r.id === focusId);
}

/**
 * The prev/next target, wrapping at both ends. `navIndex` of -1 means
 * the focused comment is not in the visible list — nothing is focused
 * yet, or the focused one has just been filtered out by hide-resolved —
 * and in that case stepping in *either* direction lands on the first
 * comment rather than on a neighbour of where the user was.
 */
export function stepComment(
  rows: readonly CommentRow[],
  navIndex: number,
  delta: number
): CommentRow | null {
  if (rows.length === 0) return null;
  const next =
    navIndex < 0 ? 0 : (navIndex + delta + rows.length) % rows.length;
  return rows[next];
}
