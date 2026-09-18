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
 * magenta × yellow = red — complements go to mud). Hence a process-cyan
 * azure for the N and a warm luminous yellow for the 10, meeting in a
 * pure green on the shared stave. Lighter tints read as glass; darker
 * ones read as paint. Isolation keeps the page background out of the
 * blend, so the mark is identical on light and dark.
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
export const LOGO_BLUE = '#2ba3ff';
export const LOGO_YELLOW = '#ffd93d';
/** LOGO_BLUE × LOGO_YELLOW, for contexts that can't blend (the favicon). */
export const LOGO_MIX = '#2b8b3d';
/** Fraction of the N's right stave the 1 covers. */
export const LOGO_OVERLAP = 0.5;

/** Stroke width; the N is 92 wide, the 10 is 142 wide. */
const STROKE = 28;
const N_RIGHT_STAVE = 64;
const TEN_WIDTH = 142;
/** Gap between N and 1 when split, matching the gap between 1 and 0. */
const SPLIT_GAP = 18;

/**
 * A flag for the 1: a wedge from the top of the stem. Its top edge runs
 * at 45° down-left for `reach` units and ends in a point, so with the
 * bar half on the N's stave the point just touches the stave's edge;
 * the lower edge returns to the stem a full stroke below. Local to the
 * 10 pane.
 */
function flagPoints(reach: number): string {
  return `0,0 ${-reach},${reach} 0,${reach + STROKE}`;
}

export interface LogoColors {
  n: string;
  ten: string;
}

const BRAND: LogoColors = { n: LOGO_BLUE, ten: LOGO_YELLOW };

/** Where the 10 pane sits, how far it slides, and the 1's flag if any. */
function geometry(overlap: number, flag: boolean) {
  const tenX = N_RIGHT_STAVE + STROKE * (1 - overlap);
  const reach = tenX - N_RIGHT_STAVE;
  return {
    tenX,
    width: tenX + TEN_WIDTH,
    split: N_RIGHT_STAVE + STROKE + SPLIT_GAP - tenX,
    flagPts: flag && reach > 0 ? flagPoints(reach) : null,
  };
}

export function Logo({
  intro = false,
  hover = false,
  colors,
  overlap = LOGO_OVERLAP,
  flag = false,
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
   * the stave, so its point touches the stave's left edge.
   */
  flag?: boolean;
} & Omit<SVGProps<SVGSVGElement>, 'children'>) {
  const { n, ten } = colors ?? BRAND;
  const { tenX, width, split, flagPts } = geometry(overlap, flag);
  const vars = { '--n10-logo-split': `${split}px` } as CSSProperties;
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
      {/* N pane: two staves and a diagonal, all 28 wide. */}
      <g fill={n} style={{ mixBlendMode: 'multiply' }}>
        <rect x="0" y="0" width="28" height="100" />
        <polygon points="0,0 34,0 92,100 58,100" />
        <rect x="64" y="0" width="28" height="100" />
      </g>
      {/* 10 pane. The outer group positions the 1 on the N's right
          stave; the inner group is what the CSS animates, so its
          transform never collides with this one. */}
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
    </svg>
  );
}
