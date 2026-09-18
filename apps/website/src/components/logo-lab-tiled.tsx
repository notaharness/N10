import { Logo, LOGO_GAP, type LogoColors } from '@/components/logo';

/**
 * The tile plane is a fixed square, not a percentage of the container.
 * The container here is wide and short (content width vs. h-72), and
 * rotating a plane that keeps that same wide/short aspect ratio never
 * reaches the container's top/bottom corners — a rotated rectangle only
 * clears a box in every direction once each of its own sides exceeds
 * that box's diagonal. 2200px clears the widest realistic container
 * (~1000px) plus its height with margin, in both axes, regardless of
 * viewport.
 */
const PLANE_SIZE = 2200;
/** One logo tile's rendered height; width follows from its own aspect. */
const TILE_SIZE = 48;
/**
 * Space between tiles matches the mark's own internal whitespace (the
 * gap between the 1 and the 0), scaled from mark units (cap height 100)
 * to this tile's pixel height, so the wallpaper reads as more of the
 * same rhythm rather than an arbitrary grid.
 */
const TILE_GAP = (LOGO_GAP / 100) * TILE_SIZE;
/**
 * Butted at TILE_GAP, so this needs more tiles than an edge-to-edge
 * grid — sized for the narrowest a tile gets (most overlap), where
 * more, smaller tiles are needed to cover the same area.
 */
const TILE_COUNT = 1100;

/**
 * The mark repeated into a diagonal wallpaper, driven by the Interactive
 * section above. The plane of tiles rotates as a whole rather than each
 * mark individually, so every glyph stays upright — it's the grid that's
 * on the diagonal, the way roof tiles or subway tile patterns work.
 */
export function LogoLabTiled({
  colors,
  overlap,
}: {
  colors: LogoColors;
  overlap: number;
}) {
  return (
    <div className="border-fd-border bg-fd-background relative h-72 overflow-hidden rounded-lg border">
      <div
        className="absolute top-1/2 left-1/2 flex flex-wrap content-start"
        style={{
          width: PLANE_SIZE,
          height: PLANE_SIZE,
          gap: TILE_GAP,
          padding: TILE_GAP,
          transform: 'translate(-50%, -50%) rotate(-45deg)',
        }}
      >
        {Array.from({ length: TILE_COUNT }, (_, i) => (
          <Logo
            key={i}
            colors={colors}
            overlap={overlap}
            className="w-auto shrink-0"
            style={{ height: TILE_SIZE }}
          />
        ))}
      </div>
    </div>
  );
}
