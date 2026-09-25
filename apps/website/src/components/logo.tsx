import type { CSSProperties, SVGProps } from 'react';
import { cn } from '@/lib/cn';

/**
 * The n10 mark: two coloured glass panes. The n is one pane, the 10 is
 * another, and the 10 sits shifted left so the 1 — a plain bar, the
 * same width as the n's stems — overlaps the n's right stem by half.
 * Half, not all: it splits the shared stave into three equal stripes
 * (sage, olive, sand), so the static mark shows the mixing itself
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
 * The mark is drawn on a square module, one stroke to a side, so it can
 * sit on a grid of that module with every edge on a line (the hero does
 * this — see hero-backdrop.tsx). The n is lowercase, 3 × 3 modules on
 * the baseline with both stems a module wide; the 1 is 1 × 4 and
 * stands a module above it, the way a numeral stands above lowercase
 * text; the 0 is a 3 × 4 stadium with a 1 × 2 hole, which reads as a
 * digit where a circle reads as the letter O. The 1–0 gap is half a
 * module, and so is the 1's step over the stem, so the merged mark is
 * exactly 7 modules wide with the n and the 0 each filling whole
 * modules. Splitting
 * opens both gaps to a full module: the 1 slides a module and a half
 * and the 0 half a module further, so in the split pose all three
 * glyphs fill whole modules — n, gap, 1, gap, 0 across 9.
 *
 * Nothing depends on a font. Units: 100 = cap height, 25 = stroke =
 * one module; the merged mark is 175 × 100. The same geometry is
 * flattened into src/app/icon.svg for the favicon.
 *
 * `intro` plays the mix once on mount (holds split, then the 10 slides
 * into the n); `hover` slides the 10 back out on hover to reveal its own
 * colour. Both are pure CSS — see the `.n10-logo` rules in global.css;
 * the `--n10-logo-*` custom properties there can be overridden per
 * instance through `style` to tune timing. The slide distance follows
 * `overlap` and is passed to the CSS as `--n10-logo-split`.
 */
export const LOGO_N_COLOR = '#9caf88';
export const LOGO_TEN_COLOR = '#e3c16f';
/** LOGO_N_COLOR × LOGO_TEN_COLOR, for contexts that can't blend (the favicon). */
export const LOGO_MIX = '#8b843b';
/** Fraction of the n's right stem the 1 covers. */
export const LOGO_OVERLAP = 0.5;

/** Stroke width, and the side of the module the mark is drawn on. */
const STROKE = 25;
/** Merged width and height in modules, for sizing the mark to a grid. */
export const LOGO_MODULES = { width: 7, height: 4 } as const;
const N_WIDTH = STROKE * 3;
const N_RIGHT_STAVE = N_WIDTH - STROKE;
const ZERO_WIDTH = STROKE * 3;
/**
 * Gap between the 1 and the 0 in the merged mark — its one unit of
 * "whitespace", useful anywhere something needs to visually match the
 * mark's own spacing (e.g. tiling it). Split, every gap is a full STROKE.
 */
export const LOGO_GAP = STROKE / 2;
const TEN_WIDTH = STROKE + LOGO_GAP + ZERO_WIDTH;
/** One module wide at top and bottom, so it crosses the counter corner to corner. */
const N_DIAGONAL = `0,0 ${STROKE},0 ${N_WIDTH},100 ${N_WIDTH - STROKE},100`;

/**
 * How the n is drawn. `lower` is the mark; `upper` (the capital it
 * replaced, 3 × 4 with a diagonal running corner to corner of its
 * counter) and `lowerGeist` are kept for /logo-lab.
 *
 * A lowercase n is not a stem plus a semicircle, which is what pure
 * geometry gives you and why that reads as an arch on a block. In a
 * drawn typeface the shoulder branches out of the stem and leaves a
 * notch where it does, the arch is thinner than the stems (horizontals
 * always are, or they look heavier), the shoulder turns down on a tight
 * radius rather than a half circle, and the counter's top is small and
 * slightly off-centre. `lower` draws that structure on the module, so
 * both stems fill whole grid cells and the 1 splits the right one into
 * thirds. `lowerGeist` is the n of Geist Black itself (the site's
 * typeface, SIL OFL) — the model for `lower` — scaled so its x-height
 * is three modules and set flush right: its stems are a touch wider
 * than a module and unequal, so it sits near the grid, not on it.
 */
export type LogoNShape = 'upper' | 'lower' | 'lowerGeist';

const LOWER_N =
  'M0,100 V25 H22.5 L23.5,37 C27,30 36,25 50,25 C64,25 75,36 75,53 V100 H50 V60 C50,50 46,45 38,45 C29,45 25,51 25,60 V100 Z';

/** Geist Black (wght 900) `n`, 1000 upm, x-height 540 → 75. Self-overlapping, so it needs the default nonzero fill. */
const LOWER_N_GEIST =
  'M2.92,100L2.92,25L27.08,25L28.19,48.89L24.86,48.61Q25.69,39.03 29.1,33.54Q32.5,28.06 37.71,25.69Q42.92,23.33 49.31,23.33Q57.08,23.33 62.85,26.67Q68.61,30 71.81,36.32Q75,42.64 75,51.81L75,100L48.06,100L48.06,61.11Q48.06,55.69 47.43,51.88Q46.81,48.06 44.93,46.04Q43.06,44.03 39.44,44.03Q34.31,44.03 32.08,48.47Q29.86,52.92 29.86,61.11L29.86,100Z';

function NGlyph({ shape }: { shape: LogoNShape }) {
  if (shape === 'upper') {
    return (
      <>
        <rect x="0" y="0" width={STROKE} height="100" />
        <polygon points={N_DIAGONAL} />
        <rect x={N_RIGHT_STAVE} y="0" width={STROKE} height="100" />
      </>
    );
  }
  return <path d={shape === 'lower' ? LOWER_N : LOWER_N_GEIST} />;
}

/**
 * A flag for the 1: a 45° slab from the top of the stem, one stroke
 * deep, reaching `reach` units left and cut vertically at the end. With
 * the bar half on the n's stem that cut sits flush on the stem's
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

/** Where the 10 pane sits, how far it slides, and the 1's flag if any. */
function logoGeometry(overlap: number, flag = false) {
  const tenX = N_RIGHT_STAVE + STROKE * (1 - overlap);
  const reach = tenX - N_RIGHT_STAVE;
  return {
    tenX,
    width: tenX + TEN_WIDTH,
    split: N_WIDTH + STROKE - tenX,
    flagPts: flag && reach > 0 ? flagPoints(reach) : null,
  };
}

/** The two panes, blended with `mix-blend-mode` — the normal, animatable mark. */
function BlendedMark({
  n,
  ten,
  tenX,
  flagPts,
  nShape,
}: {
  n: string;
  ten: string;
  tenX: number;
  flagPts: string | null;
  nShape: LogoNShape;
}) {
  return (
    <>
      {/* The outer group positions the 1 on the n's right stem; the
          inner group is what the CSS animates, so its transform never
          collides with this one. */}
      <g transform={`translate(${tenX} 0)`}>
        <g
          className="n10-logo-ten"
          fill={ten}
          style={{ mixBlendMode: 'multiply' }}
        >
          <rect x="0" y="0" width={STROKE} height="100" />
          {flagPts && <polygon points={flagPts} />}
          {/* Stroked along its centre line, so the rect is inset by half
              a stroke; rx of one stroke rounds the outside fully. */}
          <rect
            className="n10-logo-zero"
            x={STROKE + LOGO_GAP + STROKE / 2}
            y={STROKE / 2}
            width={ZERO_WIDTH - STROKE}
            height={100 - STROKE}
            rx={STROKE}
            fill="none"
            stroke={ten}
            strokeWidth={STROKE}
          />
        </g>
      </g>
      {/* The n is drawn last, so where a browser doesn't blend, the n's
          stem stays whole and the 1 goes behind it. */}
      <g fill={n} style={{ mixBlendMode: 'multiply' }}>
        <NGlyph shape={nShape} />
      </g>
    </>
  );
}

export function Logo({
  intro = false,
  hover = false,
  colors,
  overlap = LOGO_OVERLAP,
  flag = false,
  nShape = 'lower',
  className,
  style,
  ...props
}: {
  intro?: boolean;
  hover?: boolean;
  /** Pane colours; defaults to the brand pair. */
  colors?: LogoColors;
  /** Fraction of the n's right stem the 1 covers, 0–1. */
  overlap?: number;
  /**
   * Give the 1 a flag. It reaches left exactly as far as the bar is off
   * the stave, so its end sits flush on the stave's left edge.
   */
  flag?: boolean;
  /** Letterform for the n; anything but `lower` is a lab comparison. */
  nShape?: LogoNShape;
} & Omit<SVGProps<SVGSVGElement>, 'children'>) {
  const { n, ten } = colors ?? BRAND;
  const { tenX, width, split, flagPts } = logoGeometry(overlap, flag);
  const vars = {
    '--n10-logo-split': `${split}px`,
    '--n10-logo-zero-split': `${STROKE - LOGO_GAP}px`,
  } as CSSProperties;
  return (
    <svg
      viewBox={`0 0 ${width} 100`}
      role="img"
      aria-label="n10"
      overflow="visible"
      className={cn(
        'n10-logo',
        intro && 'n10-logo--intro',
        hover && 'n10-logo--hover',
        className
      )}
      style={{ isolation: 'isolate', ...vars, ...style }}
      {...props}
    >
      <title>n10</title>
      <BlendedMark
        n={n}
        ten={ten}
        tenX={tenX}
        flagPts={flagPts}
        nShape={nShape}
      />
    </svg>
  );
}
