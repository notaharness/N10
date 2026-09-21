import type { CSSProperties, SVGProps } from 'react';
import { cn } from '@/lib/cn';

/**
 * The n10 mark: two coloured glass panes. The N is one pane, the 10 is
 * another, and the 10 sits shifted left so the 1 — a plain bar, the
 * same width as the N's staves — overlaps the N's right stave by half.
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
 * this — see hero-backdrop.tsx). The N is 3 × 4 modules with a diagonal
 * that runs corner to corner of its counter; the 1 is 1 × 4; the 0 is a
 * 3 × 4 stadium with a 1 × 2 hole, which reads as a digit where a
 * circle reads as the letter O. The 1–0 gap is half a module, and so is
 * the 1's step over the stave, so the merged mark is exactly 7 modules
 * wide with the N and the 0 each filling whole modules. Splitting
 * opens both gaps to a full module: the 1 slides a module and a half
 * and the 0 half a module further, so in the split pose all three
 * glyphs fill whole modules — N, gap, 1, gap, 0 across 9.
 *
 * Nothing depends on a font. Units: 100 = cap height, 25 = stroke =
 * one module; the merged mark is 175 × 100. The same geometry is
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
 * How the N is drawn. `upper` is the mark; the lowercase forms are
 * trials for /logo-lab. Both reuse the 0's arch — a stroke-wide ring
 * with a half-module inner radius — so the n and the 0 rhyme, and both
 * keep the stem's square top-left corner, which is what makes the shape
 * an n rather than an arch. `lower` stops at a three-module x-height
 * and lets the 1 stand a module taller; `lowerTall` fills all four.
 */
export type LogoNShape = 'upper' | 'lower' | 'lowerTall';

/** The arch and both legs, from `top` down to the baseline, as one outline. */
function lowerNArch(top: number): string {
  const outer = N_WIDTH / 2;
  const inner = outer - STROKE;
  const cy = top + outer;
  return [
    `M0,100 V${cy}`,
    `A${outer},${outer} 0 0 1 ${N_WIDTH},${cy}`,
    `V100 H${N_RIGHT_STAVE} V${cy}`,
    `A${inner},${inner} 0 0 0 ${STROKE},${cy}`,
    'V100 Z',
  ].join(' ');
}

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
  const top = shape === 'lower' ? STROKE : 0;
  return (
    <>
      <rect x="0" y={top} width={STROKE} height={100 - top} />
      <path d={lowerNArch(top)} />
    </>
  );
}

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
      <g fill={n} style={{ mixBlendMode: 'multiply' }}>
        <NGlyph shape={nShape} />
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
    </>
  );
}

export function Logo({
  intro = false,
  hover = false,
  colors,
  overlap = LOGO_OVERLAP,
  flag = false,
  nShape = 'upper',
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
  /** Letterform for the N; anything but `upper` is a lab trial. */
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
