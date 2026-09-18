import type { CSSProperties, SVGProps } from 'react';
import { cn } from '@/lib/cn';

/**
 * The n10 mark: two coloured glass panes. The N is one pane, the 10 is
 * another, and the 10 sits shifted left so the 1 — a plain bar, the
 * same width as the N's staves — overlaps the N's right stave by half.
 * Half, not all: it splits the shared stave into three equal stripes
 * (blue, green, yellow), so the static mark shows the mixing itself
 * rather than leaning on the animation, and the 1 stays its own glyph.
 *
 * The panes use `mix-blend-mode: multiply` inside an isolated group.
 * Multiply is the physics of stacked gels or glass: each pane
 * transmits a fraction of each channel, so the overlap is the real
 * product of the two colours. That's subtractive mixing, and it dictates
 * the palette: two colours only multiply to a *clean* third if they
 * share a channel (cyan × yellow = green, cyan × magenta = blue,
 * magenta × yellow = red — complements go to mud). Here a muted sage
 * green and a warm sand tan, close in lightness, meet in a quiet olive
 * on the shared stave — calmer than the primaries this started from, on
 * purpose: see /logo-lab for the full set of pairs that were tried.
 * Lighter tints read as glass; darker ones read as paint. Isolation
 * keeps the page background out of the blend, so the mark is identical
 * on light and dark.
 *
 * Letterforms are bars and an ellipse rather than text, so nothing
 * depends on a font. Units: 100 = cap height, 28 = stroke; at the
 * default overlap the merged mark is 220 wide. The same geometry is
 * flattened into src/app/icon.svg for the favicon.
 *
 * `intro` plays the mix once on mount (holds split, then the 10 slides
 * into the N); `hover` slides the 10 back out on hover to reveal its own
 * colour. Both are pure CSS — see the `.n10-logo` rules in global.css;
 * the `--n10-logo-*` custom properties there can be overridden per
 * instance through `style` to tune timing. The slide distance follows
 * `overlap` and is passed to the CSS as `--n10-logo-split`.
 */
export const LOGO_N_COLOR = '#9caf88';
export const LOGO_TEN_COLOR = '#e3c16f';
/** LOGO_N_COLOR × LOGO_TEN_COLOR, for contexts that can't blend (the favicon). */
export const LOGO_MIX = '#8b843b';
/** Fraction of the N's right stave the 1 covers. */
export const LOGO_OVERLAP = 0.5;

/** Stroke width; the N is 92 wide, the 10 is 142 wide. */
const STROKE = 28;
const N_RIGHT_STAVE = 64;
const TEN_WIDTH = 142;
/**
 * Gap between N and 1 when split, matching the fixed gap between 1 and
 * 0 — the mark's one unit of "whitespace", useful anywhere something
 * needs to visually match the mark's own spacing (e.g. tiling it).
 */
export const LOGO_GAP = 18;
const SPLIT_GAP = LOGO_GAP;

/**
 * A flag for the 1: a 45° slab from the top of the stem, one stroke
 * deep, reaching `reach` units left and cut vertically at the end. With
 * the bar half on the N's stave that cut sits flush on the stave's
 * left edge. Local to the 10 pane.
 */
function flagPoints(reach: number): string {
  return `0,0 ${-reach},${reach} ${-reach},${reach + STROKE} 0,${STROKE}`;
}

export interface LogoColors {
  n: string;
  ten: string;
}

const BRAND: LogoColors = { n: LOGO_N_COLOR, ten: LOGO_TEN_COLOR };

function channel(hex: string, i: number): number {
  return parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
}

/** The multiply product of two hex colours, as the browser would blend them. */
export function multiplyColors(a: string, b: string): string {
  const hex = [0, 1, 2]
    .map((i) => Math.round((channel(a, i) * channel(b, i)) / 255))
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('');
  return `#${hex}`;
}

/**
 * Where the 10 pane sits, how far it slides, and the 1's flag if any —
 * exported so a caller can position the mark's pieces without going
 * through the `<Logo>` component itself (see `FlatMark` below).
 */
export function logoGeometry(overlap: number, flag = false) {
  const tenX = N_RIGHT_STAVE + STROKE * (1 - overlap);
  const reach = tenX - N_RIGHT_STAVE;
  return {
    tenX,
    width: tenX + TEN_WIDTH,
    split: N_RIGHT_STAVE + STROKE + SPLIT_GAP - tenX,
    flagPts: flag && reach > 0 ? flagPoints(reach) : null,
  };
}

/**
 * The mark's width-to-height ratio at a given overlap (no flag) — for
 * laying it out without rendering it, e.g. sizing tiles in a pattern.
 */
export function logoAspectRatio(overlap: number): number {
  return logoGeometry(overlap, false).width / 100;
}

/** The two panes, blended with `mix-blend-mode` — the normal, animatable mark. */
function BlendedMark({
  n,
  ten,
  tenX,
  flagPts,
}: {
  n: string;
  ten: string;
  tenX: number;
  flagPts: string | null;
}) {
  return (
    <>
      <g fill={n} style={{ mixBlendMode: 'multiply' }}>
        <rect x="0" y="0" width="28" height="100" />
        <polygon points="0,0 34,0 92,100 58,100" />
        <rect x="64" y="0" width="28" height="100" />
      </g>
      {/* The outer group positions the 1 on the N's right stave; the
          inner group is what the CSS animates, so its transform never
          collides with this one. */}
      <g transform={`translate(${tenX} 0)`}>
        <g
          className="n10-logo-ten"
          fill={ten}
          style={{ mixBlendMode: 'multiply' }}
        >
          <rect x="0" y="0" width="28" height="100" />
          {flagPts && <polygon points={flagPts} />}
          <ellipse
            cx="94"
            cy="50"
            rx="34"
            ry="36"
            fill="none"
            stroke={ten}
            strokeWidth="28"
          />
        </g>
      </g>
    </>
  );
}

/**
 * The two panes as solid fills, the overlap painted as its precomputed
 * product and clipped to the N — no blending, so it's static (nothing
 * to reveal by sliding), the same reason the favicon (icon.svg) doesn't
 * use blending either. Exported (rather than only reachable through
 * `<Logo flat>`) for logo-tile-pattern.tsx, which needs these shapes
 * with no wrapping `<svg>` at all — nesting one inside an SVG `<pattern>`
 * is its own, separate reliability problem at scale, unrelated to
 * blending; see that file.
 */
export function FlatMark({
  n,
  ten,
  tenX,
  flagPts = null,
  clipId,
}: {
  n: string;
  ten: string;
  tenX: number;
  flagPts?: string | null;
  clipId: string;
}) {
  return (
    <>
      <clipPath id={clipId}>
        <rect x="0" y="0" width="28" height="100" />
        <polygon points="0,0 34,0 92,100 58,100" />
        <rect x="64" y="0" width="28" height="100" />
      </clipPath>
      <g fill={n}>
        <rect x="0" y="0" width="28" height="100" />
        <polygon points="0,0 34,0 92,100 58,100" />
        <rect x="64" y="0" width="28" height="100" />
      </g>
      <g transform={`translate(${tenX} 0)`} fill={ten}>
        <rect x="0" y="0" width="28" height="100" />
        {flagPts && <polygon points={flagPts} />}
        <ellipse
          cx="94"
          cy="50"
          rx="34"
          ry="36"
          fill="none"
          stroke={ten}
          strokeWidth="28"
        />
      </g>
      <g clipPath={`url(#${clipId})`}>
        <rect
          x={tenX}
          y="0"
          width="28"
          height="100"
          fill={multiplyColors(n, ten)}
        />
      </g>
    </>
  );
}

/** `flat` mode has no CSS animation, so it skips the intro/hover classes. */
function logoClassName(
  flat: boolean,
  intro: boolean,
  hover: boolean,
  className: string | undefined
): string {
  return cn(
    'n10-logo',
    !flat && intro && 'n10-logo--intro',
    !flat && hover && 'n10-logo--hover',
    className
  );
}

export function Logo({
  intro = false,
  hover = false,
  colors,
  overlap = LOGO_OVERLAP,
  flag = false,
  flat = false,
  clipId = 'n10-logo-clip',
  className,
  style,
  ...props
}: {
  intro?: boolean;
  hover?: boolean;
  /** Pane colours; defaults to the brand pair. */
  colors?: LogoColors;
  /** Fraction of the N's right stave the 1 covers, 0–1. */
  overlap?: number;
  /**
   * Give the 1 a flag. It reaches left exactly as far as the bar is off
   * the stave, so its end sits flush on the stave's left edge.
   */
  flag?: boolean;
  /** Paint the overlap as a solid colour instead of blending; see FlatMark. */
  flat?: boolean;
  /** clipPath id when `flat`; must be unique if more than one is on the page. */
  clipId?: string;
} & Omit<SVGProps<SVGSVGElement>, 'children'>) {
  const { n, ten } = colors ?? BRAND;
  const { tenX, width, split, flagPts } = logoGeometry(overlap, flag);
  const vars = { '--n10-logo-split': `${split}px` } as CSSProperties;
  return (
    <svg
      viewBox={`0 0 ${width} 100`}
      role="img"
      aria-label="n10"
      overflow="visible"
      className={logoClassName(flat, intro, hover, className)}
      style={{ isolation: 'isolate', ...vars, ...style }}
      {...props}
    >
      <title>n10</title>
      {flat ? (
        <FlatMark
          n={n}
          ten={ten}
          tenX={tenX}
          flagPts={flagPts}
          clipId={clipId}
        />
      ) : (
        <BlendedMark n={n} ten={ten} tenX={tenX} flagPts={flagPts} />
      )}
    </svg>
  );
}
