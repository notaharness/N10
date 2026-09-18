import {
  FlatMark,
  LOGO_GAP,
  LOGO_N_COLOR,
  LOGO_TEN_COLOR,
  logoGeometry,
  type LogoColors,
} from '@/components/logo';

/**
 * The mark tiled as a real SVG `<pattern>`, not repeated elements. The
 * logo lab's tiled section repeats actual `<Logo>` elements in a
 * rotated, oversized flex box — fine at its bounded, contained size,
 * and it lets each tile be individually hoverable — but that approach
 * needs thousands of nodes to cover a full-bleed band that can be as
 * wide as the viewport, and covering an oversized rotated box's corners
 * needs careful sizing besides.
 *
 * `patternTransform` sidesteps both problems: the browser tiles an
 * infinite rotated plane natively, so there's no coverage math (an
 * infinite tiling rotated about any point is still an infinite tiling)
 * and no per-tile DOM cost regardless of how large the pattern paints.
 * The tradeoff is no per-tile interaction — this is for decoration.
 *
 * Two things had to change from just reusing `<Logo>` as the tile,
 * confirmed by reproducing each in isolation:
 *
 * - The tile is `FlatMark` (solid overlap colour), not the normal
 *   blended mark. Stamping many *blended, isolated* copies into one
 *   paint server renders the pattern blank once the tiled area gets
 *   large enough — this isn't a performance cliff, it's all-or-nothing
 *   per paint. Not a loss here: nothing plays hover/intro on a tile, so
 *   there was never anything for the blend to reveal.
 * - `FlatMark` is placed directly in a scaled `<g>`, not inside a
 *   nested `<svg>` (which is what `<Logo>` itself would render). A
 *   `<pattern>` whose content is a nested `<svg>` has the *same* blank
 *   -past-a-threshold failure independent of blending — confirmed by
 *   swapping only that one thing with everything else identical. Both
 *   failures reproduced at roughly 800px of tiled width and up; neither
 *   failure is specific to this browser or to headless rendering.
 */
export function LogoTilePattern({
  colors,
  overlap = 0.5,
  tileSize,
  id,
  className,
}: {
  colors?: LogoColors;
  overlap?: number;
  tileSize: number;
  /** Unique per instance if more than one ever renders on the same page. */
  id: string;
  className?: string;
}) {
  const gap = (LOGO_GAP / 100) * tileSize;
  const { tenX, width } = logoGeometry(overlap);
  const scale = tileSize / 100;
  const { n, ten } = colors ?? { n: LOGO_N_COLOR, ten: LOGO_TEN_COLOR };

  return (
    <svg aria-hidden className={className} width="100%" height="100%">
      <defs>
        <pattern
          id={id}
          patternUnits="userSpaceOnUse"
          width={width * scale + gap}
          height={tileSize + gap}
          patternTransform="rotate(-45)"
        >
          <g transform={`scale(${scale})`}>
            <FlatMark n={n} ten={ten} tenX={tenX} clipId={`${id}-clip`} />
          </g>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}
