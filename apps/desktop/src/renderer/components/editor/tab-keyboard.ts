import { KeyboardSensor } from '@dnd-kit/core';
import type { KeyboardEvent } from 'react';

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

/**
 * The tab pattern's keys on a tab that is not being dragged: Enter or
 * Space activates it, the arrows (wrapping), Home and End move focus
 * along the row.
 */
export function handleTabKey(
  e: KeyboardEvent<HTMLElement>,
  onActivate: () => void
): void {
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    // Handled here, so no window-level shortcut sees it as well.
    e.stopPropagation();
    onActivate();
    return;
  }
  const step = FOCUS_STEP[e.key];
  const row = e.currentTarget.closest('[role="tablist"]');
  if (!step || !row) return;
  e.preventDefault();
  e.stopPropagation();
  const tabs = [...row.querySelectorAll<HTMLElement>('[role="tab"]')];
  tabs[step(tabs.indexOf(e.currentTarget), tabs.length)]?.focus();
}
