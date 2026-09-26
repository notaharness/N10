import {
  closestCenter,
  DndContext,
  KeyboardSensor,
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
import type { ReactNode } from 'react';
import { usePrefersReducedMotion } from '../../lib/reduced-motion.js';

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
 * The tab row, sortable by pointer and by keyboard (focus a tab, Space
 * or Enter to lift, arrows to move, Space or Enter to drop, Escape to
 * cancel). The other tabs slide aside while one is dragged; the order
 * only changes in the model on drop.
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
    useSensor(KeyboardSensor, {
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
      accessibility={{ announcements }}
      onDragEnd={onDragEnd}
    >
      <SortableContext
        items={[...ids]}
        strategy={horizontalListSortingStrategy}
      >
        <div className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-border bg-tab [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {children}
          <div className="flex-1" />
        </div>
      </SortableContext>
    </DndContext>
  );
}

/** What a tab in `TabStrip` spreads onto its element to be sortable;
 *  `label` is what the drag announcements call it. */
export function useSortableTab(id: string, label: string) {
  const reducedMotion = usePrefersReducedMotion();
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id,
    data: { label },
    attributes: { role: 'tab' },
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
    props: { ...attributes, ...listeners },
    style: { transform: CSS.Translate.toString(transform), transition },
    isDragging,
  };
}
