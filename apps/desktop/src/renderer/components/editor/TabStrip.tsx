import {
  closestCenter,
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type Active,
  type Announcements,
  type DragEndEvent,
  type Over,
} from '@dnd-kit/core';
import { restrictToHorizontalAxis } from '@dnd-kit/modifiers';
import {
  horizontalListSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { KeyboardEvent, ReactNode } from 'react';
import { usePrefersReducedMotion } from '../../lib/reduced-motion.js';
import {
  ChordKeyboardSensor,
  handleTabKey,
  screenReaderInstructions,
} from './tab-keyboard.js';

/** How far the pointer travels before a press becomes a drag, so
 *  clicks and double clicks on a tab stay clicks. */
const DRAG_THRESHOLD_PX = 5;

/** A tab as a screen reader hears it: its label, not its id. */
function spoken(target: Active | Over): string {
  const data = target.data.current as { label?: string } | undefined;
  return data?.label ?? String(target.id);
}

const announcements: Announcements = {
  onDragStart: ({ active }) => `Picked up ${spoken(active)}.`,
  onDragOver: ({ active, over }) =>
    over
      ? `${spoken(active)} is over ${spoken(over)}.`
      : `${spoken(active)} is not over a tab.`,
  onDragEnd: ({ active, over }) =>
    over
      ? `${spoken(active)} was dropped over ${spoken(over)}.`
      : `${spoken(active)} was dropped.`,
  onDragCancel: ({ active }) => `Moving ${spoken(active)} was cancelled.`,
};

/**
 * The tab row, sortable by pointer and by keyboard (see
 * `tab-keyboard.ts`: a chord lifts, so Enter and Space still activate).
 * The other tabs slide aside while one is dragged; the order only
 * changes in the model on drop.
 */
export function TabStrip({
  ids,
  onMove,
  children,
}: {
  ids: readonly string[];
  onMove: (id: string, targetId: string, side: 'before' | 'after') => void;
  children: ReactNode;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: DRAG_THRESHOLD_PX },
    }),
    useSensor(ChordKeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const id = String(active.id);
    const targetId = String(over.id);
    // Dropped over a tab to its right, it lands after that tab — the
    // slot the others made room for.
    const side = ids.indexOf(id) < ids.indexOf(targetId) ? 'after' : 'before';
    onMove(id, targetId, side);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToHorizontalAxis]}
      accessibility={{ announcements, screenReaderInstructions }}
      onDragEnd={onDragEnd}
    >
      <SortableContext
        items={[...ids]}
        strategy={horizontalListSortingStrategy}
      >
        <div
          role="tablist"
          aria-label="Open tabs"
          className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-border bg-tab [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {children}
          <div className="flex-1" aria-hidden />
        </div>
      </SortableContext>
    </DndContext>
  );
}

/**
 * What a tab in `TabStrip` spreads onto its element to be sortable.
 * `label` is what the drag announcements call it; `tabStop` makes it
 * the row's one Tab stop (the arrows move focus within the row).
 */
export function useSortableTab({
  id,
  label,
  tabStop,
  onActivate,
}: {
  id: string;
  label: string;
  tabStop: boolean;
  onActivate: () => void;
}) {
  const reducedMotion = usePrefersReducedMotion();
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
    active,
  } = useSortable({
    id,
    data: { label },
    attributes: {
      role: 'tab',
      roleDescription: 'sortable tab',
      tabIndex: tabStop ? 0 : -1,
    },
    // `null` turns the slide off; the tabs then jump to their places.
    transition: reducedMotion ? null : undefined,
  });
  return {
    // The tab is its own handle. Naming it the activator also keeps
    // Enter on its close button from lifting the tab.
    setNode: (node: HTMLElement | null) => {
      setNodeRef(node);
      setActivatorNodeRef(node);
    },
    props: {
      ...attributes,
      ...listeners,
      onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
        listeners?.onKeyDown?.(e);
        // The sensor took it (the lift chord), a drag is under way, or
        // the key was meant for the close button inside the tab.
        if (e.defaultPrevented || active || e.target !== e.currentTarget)
          return;
        handleTabKey(e, onActivate);
      },
    },
    style: { transform: CSS.Translate.toString(transform), transition },
    isDragging,
  };
}
