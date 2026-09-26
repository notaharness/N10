import type { ReviewComment } from '../../../host/contract.js';

/**
 * What the review agent drafts on #175, in the order its script adds
 * them. Each is anchored to a line of that pull request's final diff.
 */
type Draft = Omit<ReviewComment, 'id' | 'status' | 'createdAt'>;

export const REVIEW_DRAFTS: readonly Draft[] = [
  {
    file: 'apps/desktop/src/renderer/lib/review/review-model.ts',
    lineStart: 314,
    lineEnd: 314,
    side: 'RIGHT',
    severity: 'minor',
    body: 'question: is this the first thread in document order?\n\nThe description says "the first unresolved remote thread in document order", but this takes the rows in the rail\'s order. The two agree only while `CommentsList` sorts by file and then line. A spec case with threads out of file order would pin that down, or sort here.',
  },
  {
    file: 'apps/desktop/src/renderer/lib/review/use-review-rail.ts',
    lineStart: 33,
    lineEnd: 37,
    side: 'RIGHT',
    severity: 'minor',
    body: 'issue: one animation frame can be too early\n\nWhen the rail was hidden, unhiding it and expanding Comments can take two commits, and `querySelector` finds nothing on the first; the scroll then silently does nothing. Retrying on the next frame when the row is missing would cover it.',
  },
  {
    file: 'apps/desktop/src/renderer/lib/review/use-review-rail.ts',
    lineStart: 68,
    lineEnd: 70,
    side: 'RIGHT',
    severity: 'nit',
    body: 'suggestion (non-blocking): say why when the refetch fails\n\nA failed refetch drops the click without a word, so the button just looks dead. A toast with the error would say why.',
  },
  {
    file: 'apps/desktop/src/renderer/components/review/PrHeader.tsx',
    lineStart: 118,
    lineEnd: 118,
    side: 'RIGHT',
    severity: 'nit',
    body: 'nitpick: the label is announced twice\n\n`Tip` already describes the button with this same text, so a screen reader reads "Show 2 unresolved comments" twice. The visible text plus the tooltip may be enough without `aria-label`.',
  },
];
