import type { SVGProps } from 'react';
import { cn } from '@/lib/cn';

/**
 * The n10 mark: two coloured glass panes. The N is one pane, the 10 is
 * another, and the 10 sits shifted left so the 1 — a plain bar, the
 * same width as the N's staves — lies exactly on the N's right stave.
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
 * depends on a font. Units: 100 = cap height; the merged mark is 178
 * wide. The same geometry is flattened into src/app/icon.svg for the
 * favicon.
 *
 * `intro` plays the mix once on mount (holds split, then the 10 slides
 * into the N); `hover` slides the 10 back out on hover to reveal its own
 * colour. Both are pure CSS — see the `.n10-logo` rules in global.css.
 */
export const LOGO_BLUE = '#2ba3ff';
export const LOGO_YELLOW = '#ffd93d';
/** LOGO_BLUE × LOGO_YELLOW, for contexts that can't blend (the favicon). */
export const LOGO_MIX = '#2b8b3d';
/**
 * How far the 10 slides right (in mark units) to separate: the 1 then
 * sits the same 16 units from the N as the 0 sits from the 1.
 */
export const LOGO_SPLIT_OFFSET = 38;

export function Logo({
  intro = false,
  hover = false,
  className,
  ...props
}: {
  intro?: boolean;
  hover?: boolean;
} & Omit<SVGProps<SVGSVGElement>, 'children'>) {
  return (
    <svg
      viewBox="0 0 178 100"
      role="img"
      aria-label="n10"
      overflow="visible"
      className={cn(
        'n10-logo',
        intro && 'n10-logo--intro',
        hover && 'n10-logo--hover',
        className
      )}
      style={{ isolation: 'isolate' }}
      {...props}
    >
      <title>n10</title>
      {/* N pane: two staves and a diagonal, all 22 wide. */}
      <g fill={LOGO_BLUE} style={{ mixBlendMode: 'multiply' }}>
        <rect x="0" y="0" width="22" height="100" />
        <polygon points="0,0 26,0 78,100 52,100" />
        <rect x="56" y="0" width="22" height="100" />
      </g>
      {/* 10 pane. The outer group positions the 1 on the N's right
          stave; the inner group is what the CSS animates, so its
          transform never collides with this one. */}
      <g transform="translate(56 0)">
        <g
          className="n10-logo-ten"
          fill={LOGO_YELLOW}
          style={{ mixBlendMode: 'multiply' }}
        >
          <rect x="0" y="0" width="22" height="100" />
          <ellipse
            cx="80"
            cy="50"
            rx="31"
            ry="39"
            fill="none"
            stroke={LOGO_YELLOW}
            strokeWidth="22"
          />
        </g>
      </g>
    </svg>
  );
}
