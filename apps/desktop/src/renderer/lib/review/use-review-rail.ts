import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';
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
  threads: { isFetching: boolean; refetch: () => Promise<unknown> },
  rootRef: RefObject<HTMLElement | null>
) {
  const [hidden, setHidden] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(true);
  const { items, jumpToId } = nav;
  const { isFetching, refetch } = threads;

  // The row is looked up after the click commits: the rail may have
  // just been unhidden or the list expanded.
  const reveal = useCallback(
    (row: CommentRow) => {
      jumpToId(row.id, row.file);
      requestAnimationFrame(() =>
        rootRef.current
          ?.querySelector(`[data-comment-row="${CSS.escape(row.id)}"]`)
          ?.scrollIntoView({ block: 'nearest' })
      );
    },
    [jumpToId, rootRef]
  );

  // The count is the pull request list's and the threads are their own
  // query, so a click can land before the threads load or while the
  // cache is behind the count. Then the click is held, the threads are
  // fetched, and it lands once they arrive; if the fresh list has no
  // open thread either, it is dropped rather than firing later.
  const pending = useRef(false);
  useEffect(() => {
    if (!pending.current) return;
    const first = firstUnresolvedThread(items);
    if (first) {
      pending.current = false;
      reveal(first);
    } else if (!isFetching) {
      pending.current = false;
    }
  }, [items, isFetching, reveal]);

  const showUnresolved = useCallback(() => {
    setHidden(false);
    setCommentsOpen(true);
    const first = firstUnresolvedThread(items);
    pending.current = first == null;
    if (first) {
      reveal(first);
      return;
    }
    refetch().catch(() => {
      pending.current = false;
    });
  }, [items, reveal, refetch]);

  return { hidden, setHidden, commentsOpen, setCommentsOpen, showUnresolved };
}
