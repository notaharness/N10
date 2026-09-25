import type { ReactNode } from 'react';
import { Box } from 'ink';
import { useLayout } from '@n10/app-core';

interface ModalProps {
  /** Inner content. Will be centered inside the terminal. */
  children: ReactNode;
  /**
   * Width of the modal's content column. Defaults to 60 columns, which
   * reads well in most terminals without hugging the edges. Pass a
   * number or "auto" to let the content size itself.
   */
  width?: number | 'auto';
}

// A reusable modal overlay. Covers the entire terminal viewport and
// flex-centers its child in the middle of the screen. Designed to be
// rendered as a sibling of the main layout, NOT nested inside it —
// typically at the root of the App component (see tui.tsx).
//
// ── Why this exists ────────────────────────────────────────────────
// Ink's `position="absolute"` with just the four top/right/bottom/left
// offsets (to stretch-to-fill) is unreliable in practice. It anchors
// the element to top-left and ignores the implied dimensions, so
// `alignItems`/`justifyContent` never get a parent box to center
// against. Reading the terminal dimensions from LayoutContext and
// setting explicit `width` + `height` sidesteps the ambiguity —
// Yoga gets a concrete rectangle to lay out inside.
//
// ── Painting ───────────────────────────────────────────────────────
// This wrapper does NOT paint a background — the area outside the
// centered dialog stays as-is so the underlying app is visible behind
// it. The dialog itself MUST set its own `backgroundColor` (e.g. on
// the Pane it renders), otherwise Ink leaves the dialog's blank
// padding/gap cells transparent and underlying text bleeds through
// inside the dialog footprint. (Border chars and explicit text DO
// overwrite their cells, but blank padding does not.)
//
// ── Input layering ─────────────────────────────────────────────────
// Ink has NO z-index hit-testing — input is routed via `useInput`,
// not by visual layer. Rendering this overlay does NOT suspend any
// other `useInput` hooks elsewhere in the tree. The caller MUST
// ensure that whatever modal opens this also gates other input
// handlers so only the modal's input fires.
//
// In n10 today this is enforced by MainTab's useInput router (see
// `screens/main/MainTab.tsx`), which checks `deleteConfirm.confirmDelete`
// first and routes to `handleConfirmDeleteInput`. Other useInput hooks
// (DiffPane, raw stdin forwarding, etc.) are gated on pane modes that
// are mutually exclusive with the delete flow. Future modals must
// audit and document the same way.
//
// Usage:
//   <Modal>
//     <Pane focused title="Confirm Delete">...</Pane>
//   </Modal>
export function Modal({ children, width = 60 }: ModalProps) {
  const { termCols, termRows } = useLayout();

  return (
    <Box
      position="absolute"
      // Ink supports these offsets at runtime but the type definitions
      // lag behind. Spread as an untyped object so the intent stays
      // greppable and this can be removed when types catch up.
      {...({ top: 0, left: 0 } as object)}
      width={termCols}
      height={termRows}
      alignItems="center"
      justifyContent="center"
    >
      <Box width={width} flexDirection="column">
        {children}
      </Box>
    </Box>
  );
}
