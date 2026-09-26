import type { ReviewDecision } from '@n10/vcs-core/types';
import type { SidebarItem } from '../../../host/contract.js';

export type SectionKey =
  | 'worktrees'
  | 'draft-pull-requests'
  | 'pull-requests'
  | 'needs-review'
  | 'waiting'
  | 'approved';

export const SECTION_ORDER: SectionKey[] = [
  'worktrees',
  'draft-pull-requests',
  'pull-requests',
  'needs-review',
  'waiting',
  'approved',
];

export const SECTION_LABEL: Record<SectionKey, string> = {
  worktrees: 'Worktrees',
  'draft-pull-requests': 'Draft Pull Requests',
  'pull-requests': 'Pull Requests',
  'needs-review': 'Needs Your Review',
  waiting: 'Waiting for Author',
  approved: 'Approved by You',
};

/**
 * Stable identity for an editor tab / selection. A single PR keeps the
 * same key as it moves between sidebar kinds — launching an agent turns
 * an orphan/review PR into a session-backed row, and it must not orphan
 * the open tab — so any PR-bearing item is keyed by its PR id, and a
 * plain worktree by its branch.
 */
export function itemKey(item: SidebarItem): string {
  const pr = item.pr;
  if (pr) return `pr:${pr.id}`;
  if (item.kind === 'session')
    return `branch:${item.branch ?? item.session.label ?? item.session.name}`;
  return `pr:${item.pr.id}`;
}

export function sectionKey(item: SidebarItem): SectionKey {
  if (item.kind === 'session') {
    if (!item.pr) return 'worktrees';
    return item.pr.isDraft ? 'draft-pull-requests' : 'pull-requests';
  }
  if (item.kind === 'orphan-pr') {
    return item.pr.isDraft ? 'draft-pull-requests' : 'pull-requests';
  }
  if (item.category === 'needs-review') return 'needs-review';
  if (item.category === 'waiting') return 'waiting';
  return 'approved';
}

export function itemRunning(item: SidebarItem): boolean {
  if (item.kind === 'session') return item.session.running;
  return item.running === true;
}

/**
 * What an item is called on screen: its pull request's title when it
 * has one, its branch otherwise. A branch name is a slug the author
 * typed once; the title is what the work is about, and it is what a
 * reader scanning a sidebar or a tab strip is looking for.
 */
export function itemTitle(item: SidebarItem): string {
  if (item.kind !== 'session') return item.pr.title;
  return (
    item.pr?.title ?? item.branch ?? item.session.label ?? item.session.name
  );
}

/** The git branch an item corresponds to. */
export function itemBranch(item: SidebarItem): string {
  if (item.kind === 'session')
    return item.branch ?? item.session.label ?? item.session.name;
  return item.pr.sourceBranch;
}

/** The worktree checkout an item lives in — only a worktree row knows
 *  it. */
export function itemWorktree(item: SidebarItem): string | undefined {
  return item.kind === 'session' ? item.session.path : undefined;
}

/** PTY session name for an item — the worktree session, or (for PR
 *  items) the alive review session the host attached to it. */
export function itemSessionName(item: SidebarItem): string | undefined {
  if (item.kind === 'session') return item.session.name;
  return item.sessionName;
}

export function itemHasWorktree(item: SidebarItem): boolean {
  if (item.kind === 'session') return true;
  return Boolean(item.sessionName);
}

/**
 * Reflect worktree removals that have been confirmed but not yet
 * finished, so the whole window reacts when the user clicks Remove
 * rather than when git and the session teardown are done.
 *
 * The two row kinds want opposite treatment, which is the part that is
 * easy to get wrong: a plain worktree row *is* the worktree and goes,
 * but a PR row outlives its checkout — the pull request is still open
 * and still belongs in its review section. Dropping it would blank a
 * row the refetch then puts straight back. So the PR row stays and only
 * the parts that describe a worktree are cleared, which is also what
 * takes "Stop agent" and "Remove worktree…" out of its context menu and
 * stops its running indicator.
 *
 * Nothing here needs rolling back: a failed removal stops being
 * pending, and the rows return exactly as they were.
 */
export function applyPendingRemovals(
  items: SidebarItem[],
  removing: ReadonlySet<string>
): SidebarItem[] {
  if (removing.size === 0) return items;
  return items.flatMap((item) => {
    if (!removing.has(itemBranch(item))) return [item];
    if (item.kind === 'session') return [];
    return [{ ...item, sessionName: undefined, running: undefined }];
  });
}

export interface SidebarSection {
  key: SectionKey;
  label: string;
  items: SidebarItem[];
}

/** Group the ordered flat list into its sections (TUI order preserved). */
export function groupSections(items: SidebarItem[]): SidebarSection[] {
  const map = new Map<SectionKey, SidebarItem[]>();
  for (const item of items) {
    const k = sectionKey(item);
    const arr = map.get(k);
    if (arr) arr.push(item);
    else map.set(k, [item]);
  }
  return SECTION_ORDER.filter((k) => map.has(k)).map((k) => ({
    key: k,
    label: SECTION_LABEL[k],
    items: map.get(k) ?? [],
  }));
}

// ── Pull request status cluster ──────────────────────────────────

/**
 * A pull request row shows one circle standing for two independent
 * facts, so what each visual channel means has to be decided rather
 * than left to fall out of the code:
 *
 *   colour — the worst thing standing in the way
 *   glyph  — which of the two axes that thing is
 *   filled — nothing outstanding on either
 *
 * Colour is deliberately asymmetric. CI can only ever make a row more
 * urgent, never less: a passing build does not lift a request that
 * nobody has approved, while a failing one is red however many
 * approvals it has. Green therefore means people have signed off, which
 * makes it rare enough to be worth noticing in a long list.
 */
export type ApprovalState = 'rejected' | 'blocked' | 'approved' | 'partial';
export type CiState = 'passed' | 'failed' | 'running' | 'absent';
export type StatusTone = 'red' | 'yellow' | 'green' | 'muted';
export type StatusGlyph =
  | 'rejected'
  | 'waiting'
  | 'approved'
  | 'partial'
  | 'ci-failed'
  | 'ci-running'
  | 'ci-absent'
  | 'ci-passed';

export interface PrStatusIndicator {
  approval: ApprovalState;
  /** `absent` covers both "never ran" and "withdrew" — Azure checks
   *  that end `notApplicable` land here. */
  ci: CiState;
  tone: StatusTone;
  glyph: StatusGlyph;
  label: string;
  filled: boolean;
  approved: number;
  total: number;
}

/**
 * How much each state demands attention. The glyph shows whichever axis
 * scores higher, so the circle depicts the thing actually holding the
 * request up rather than always depicting CI — which is what produced a
 * green tick sitting inside a red circle on a rejected request.
 *
 * Approvals win a tie: they are somebody's decision, and CI is still
 * spelled out in the tooltip either way.
 */
const APPROVAL_SEVERITY: Record<ApprovalState, number> = {
  rejected: 3,
  blocked: 2,
  partial: 1,
  approved: 0,
};
const CI_SEVERITY: Record<CiState, number> = {
  failed: 3,
  running: 2,
  absent: 1,
  passed: 0,
};

const APPROVAL_GLYPH: Record<ApprovalState, StatusGlyph> = {
  rejected: 'rejected',
  blocked: 'waiting',
  partial: 'partial',
  approved: 'approved',
};
const CI_GLYPH: Record<CiState, StatusGlyph> = {
  failed: 'ci-failed',
  running: 'ci-running',
  absent: 'ci-absent',
  passed: 'ci-passed',
};

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function ciPhrase(ci: CiState): string {
  if (ci === 'passed') return 'CI passed';
  if (ci === 'failed') return 'CI failed';
  if (ci === 'running') return 'CI running';
  return 'No CI result';
}

function approvalPhrase(
  approval: ApprovalState,
  approved: number,
  total: number
): string {
  const of = `${approved} of ${plural(total, 'reviewer')} approved`;
  if (approval === 'rejected') return `changes rejected (${of})`;
  if (approval === 'blocked') return `waiting for the author (${of})`;
  if (approval === 'approved') {
    return `all ${plural(total, 'reviewer')} approved`;
  }
  if (total === 0) return 'no reviewers yet';
  return `waiting on ${plural(total - approved, 'approval')} (${of})`;
}

function ciState(buildStatus: string | undefined): CiState {
  if (buildStatus === 'succeeded') return 'passed';
  if (buildStatus === 'failed') return 'failed';
  if (buildStatus === 'pending') return 'running';
  return 'absent';
}

function toneFor(approval: ApprovalState, ci: CiState): StatusTone {
  if (ci === 'failed' || approval === 'rejected') return 'red';
  if (ci === 'running' || approval === 'blocked') return 'yellow';
  // Only approvals earn green. A passing build on a request nobody has
  // approved is not progress anyone can act on.
  if (approval === 'approved') return 'green';
  return 'muted';
}

/**
 * Both axes of a pull request's state, how to draw them, and the
 * sentence describing them.
 *
 * The one cell with its own wording is the one a reader acts on:
 * approvals in and CI green means the request can be merged, and saying
 * so beats making them read two clauses and draw the conclusion.
 */
export function prStatusIndicator(
  reviewers: { decision: ReviewDecision }[],
  buildStatus: string | undefined,
  isBlocking: (decision: ReviewDecision) => boolean
): PrStatusIndicator {
  const total = reviewers.length;
  const approved = reviewers.filter((r) => r.decision === 'approved').length;
  const ci = ciState(buildStatus);

  const approval: ApprovalState = reviewers.some(
    (r) => r.decision === 'rejected'
  )
    ? 'rejected'
    : reviewers.some((r) => isBlocking(r.decision))
    ? 'blocked'
    : total > 0 && approved === total
    ? 'approved'
    : 'partial';

  const glyph =
    CI_SEVERITY[ci] > APPROVAL_SEVERITY[approval]
      ? CI_GLYPH[ci]
      : APPROVAL_GLYPH[approval];

  const ready = approval === 'approved' && ci === 'passed';
  const label = ready
    ? `Ready to merge — CI passed, all ${plural(total, 'reviewer')} approved`
    : `${ciPhrase(ci)} — ${approvalPhrase(approval, approved, total)}`;

  return {
    approval,
    ci,
    tone: toneFor(approval, ci),
    glyph,
    label,
    filled: ready,
    approved,
    total,
  };
}

/** Tooltip for the comment count. */
export function unresolvedCommentsLabel(count: number): string {
  return `${plural(count, 'unresolved comment')}`;
}

/**
 * The session name a row can actually be driven through, or undefined.
 *
 * The sidebar names a would-be session for every worktree, launched or
 * not — the name is derived from the branch. Only a name the host has
 * really launched has a PTY behind it, so reading the row's name as
 * "a session exists" offered to *re*launch an agent that had never run
 * and mounted a terminal pane with nothing in it.
 */
export function liveSessionName(
  rowSessionName: string | undefined,
  sessions: readonly { name: string }[]
): string | undefined {
  if (rowSessionName == null) return undefined;
  return sessions.some((s) => s.name === rowSessionName)
    ? rowSessionName
    : undefined;
}
