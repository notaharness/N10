import { useCallback, useState, type RefObject } from 'react';
import { firstUnresolvedThread, type CommentRow } from './review-model.js';

/**
 * The review rail's own visibility: hidden or shown, its Comments list
 * collapsed or expanded, and the header's "N unresolved" count, which
 * opens both and focuses the first open thread in the diff and the list.
 */
export function useReviewRail(
  nav: {
    items: readonly CommentRow[];
    jumpToId: (id: string, file: string | null) => void;
  },
  rootRef: RefObject<HTMLElement | null>
) {
  const [hidden, setHidden] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(true);
  const { items, jumpToId } = nav;

  // The row is looked up after the click commits: the rail may have
  // just been unhidden or the list expanded.
  const showUnresolved = useCallback(() => {
    setHidden(false);
    setCommentsOpen(true);
    const first = firstUnresolvedThread(items);
    if (!first) return;
    jumpToId(first.id, first.file);
    requestAnimationFrame(() =>
      rootRef.current
        ?.querySelector(`[data-comment-row="${CSS.escape(first.id)}"]`)
        ?.scrollIntoView({ block: 'nearest' })
    );
  }, [items, jumpToId, rootRef]);

  return { hidden, setHidden, commentsOpen, setCommentsOpen, showUnresolved };
}
