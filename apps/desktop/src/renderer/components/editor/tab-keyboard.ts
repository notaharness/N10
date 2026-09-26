import { KeyboardSensor } from '@dnd-kit/core';
import type { KeyboardEvent, MouseEvent } from 'react';

/** Ctrl+Shift+Space lifts the focused tab; Enter and Space are left to
 *  the tab pattern, where they activate it. */
function isLiftChord(e: globalThis.KeyboardEvent): boolean {
  return (
    e.code === 'Space' && e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey
  );
}

/**
 * dnd-kit's keyboard sensor, lifting on the chord instead of on a bare
 * Space or Enter. Once lifted it behaves as usual: arrows move, Space
 * or Enter drops, Escape cancels.
 */
export class ChordKeyboardSensor extends KeyboardSensor {
  static override activators: typeof KeyboardSensor.activators =
    KeyboardSensor.activators.map((activator) => ({
      ...activator,
      handler: (event, options, context) =>
        isLiftChord(event.nativeEvent as globalThis.KeyboardEvent) &&
        activator.handler(event, options, context),
    }));
}

export const screenReaderInstructions = {
  draggable:
    'To move this tab, press Control Shift Space. Then use the arrow ' +
    'keys to move it, Space to drop it, or Escape to cancel.',
};

const FOCUS_STEP: Record<string, (at: number, count: number) => number> = {
  ArrowLeft: (at, count) => (at - 1 + count) % count,
  ArrowRight: (at, count) => (at + 1) % count,
  Home: () => 0,
  End: (_at, count) => count - 1,
};

/** What the keys on a focused tab do to it. */
export interface TabKeyActions {
  activate: () => void;
  close: () => void;
}

/**
 * The tab pattern's keys on a tab that is not being dragged: Enter or
 * Space activates it, Delete closes it, the arrows (wrapping), Home and
 * End move focus along the row. Each handled key is `preventDefault`ed,
 * which window-level shortcuts take as already handled.
 */
export function handleTabKey(
  e: KeyboardEvent<HTMLElement>,
  actions: TabKeyActions
): void {
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  const action =
    e.key === 'Enter' || e.key === ' '
      ? actions.activate
      : e.key === 'Delete'
      ? actions.close
      : undefined;
  if (action) {
    e.preventDefault();
    action();
    return;
  }
  const step = FOCUS_STEP[e.key];
  const row = e.currentTarget.closest('[role="tablist"]');
  if (!step || !row) return;
  e.preventDefault();
  const tabs = [...row.querySelectorAll<HTMLElement>('[role="tab"]')];
  tabs[step(tabs.indexOf(e.currentTarget), tabs.length)]?.focus();
}

/**
 * A primary press on a tab takes no focus, and lets go of whatever had
 * it. The pane it activates then owns the keyboard — a terminal focuses
 * itself, the review walkthrough's window shortcuts see the keys — and
 * the row is reached with Tab. Drags start on `pointerdown`, which this
 * leaves alone.
 */
export function pressWithoutFocus(e: MouseEvent<HTMLElement>): void {
  if (e.button !== 0) return;
  e.preventDefault();
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
}
