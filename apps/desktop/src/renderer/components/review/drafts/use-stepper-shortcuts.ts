import { useEffect } from 'react';

export interface StepperShortcuts {
  onNext: () => void;
  onPrev: () => void;
  onEdit: () => void;
  onPost: () => void;
  onDiscard: () => void;
  onExit: () => void;
}

/**
 * Keyboard shortcuts for the review walkthrough.
 *
 * Ignored while editing the textarea, and while this tab is in the
 * background — `d` discards and `Enter` posts, so a stray keypress
 * elsewhere in the app must not reach them. The listener is on
 * `window` because the walkthrough has no single focused element to
 * hang it off, which is exactly why `enabled` has to be explicit: the
 * pane stays mounted behind other tabs (a live agent keeps its
 * terminal alive).
 */
export function useStepperShortcuts(
  enabled: boolean,
  handlers: StepperShortcuts
): void {
  const { onNext, onPrev, onEdit, onPost, onDiscard, onExit } = handlers;
  useEffect(() => {
    if (!enabled) return;
    // Built inside the effect so the table closes over the same
    // callbacks the dependency list names — a `handlers` object read
    // directly would be a new reference every render and re-bind the
    // listener each time.
    const actions: Record<string, () => void> = {
      ArrowDown: onNext,
      ArrowRight: onNext,
      j: onNext,
      ArrowUp: onPrev,
      ArrowLeft: onPrev,
      k: onPrev,
      e: onEdit,
      p: onPost,
      Enter: onPost,
      d: onDiscard,
      Escape: onExit,
    };
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      const run = actions[e.key];
      if (!run) return;
      e.preventDefault();
      run();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, onNext, onPrev, onEdit, onPost, onDiscard, onExit]);
}
