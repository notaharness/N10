import type { SVGProps } from 'react';
import { cn } from '@/lib/cn';

/**
 * The n10 mark: two coloured glass panes. The n is one pane, the 10 is
 * another, and the 10 sits shifted left so the 1's bar lands on the n's
 * right stem. The panes use `mix-blend-mode: multiply` inside an
 * isolated group, so where they overlap the colour is the real product
 * of the two — blue × yellow = green — the same way two lighting gels
 * stack. Isolation keeps the page background out of the blend, so the
 * mark reads identically on light and dark.
 *
 * The n is lowercase on purpose: its stem only reaches x-height, so the
 * cap-height 1 rises clear above it and stays legibly a "1" even with
 * its whole lower half mixed into the stem. (With a capital N the bar
 * is swallowed entirely and the mark reads "N0".) The green boundary
 * follows the n's shoulder curve; the flag of the 1 just grazes the
 * arch for a second, smaller sliver of mixing.
 *
 * Letterforms are built from bars and arcs rather than text so the mark
 * never depends on a font. Units: 100 = cap height, 66 = x-height; the
 * merged mark is 158 wide. The same geometry is flattened into
 * src/app/icon.svg for the favicon.
 *
 * `intro` plays the mix once on mount (starts split, the 10 slides left
 * into the n); `hover` slides the 10 back out on hover to reveal its own
 * colour. Both are pure CSS — see the `.n10-logo` rules in global.css.
 */
export const LOGO_BLUE = '#1e90ff';
export const LOGO_YELLOW = '#ffd633';
/**
 * How far the 10 slides right (in mark units) to separate: the 1 then
 * sits the same 16 units from the n as the 0 sits from the 1.
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
      viewBox="0 0 158 100"
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
      {/* n pane: left stem to x-height, half-annulus arch, right stem. */}
      <g fill={LOGO_BLUE} style={{ mixBlendMode: 'multiply' }}>
        <rect x="0" y="34" width="22" height="66" />
        <path d="M0 73 A39 39 0 0 1 78 73 L56 73 A17 17 0 0 0 22 73 Z" />
        <rect x="56" y="73" width="22" height="27" />
      </g>
      {/* 10 pane. The outer group positions the 1's bar on the n's right
          stem; the inner group is what the CSS animates, so its
          transform never collides with this one. */}
      <g transform="translate(56 0)">
        <g
          className="n10-logo-ten"
          fill={LOGO_YELLOW}
          style={{ mixBlendMode: 'multiply' }}
        >
          <rect x="0" y="0" width="22" height="100" />
          <polygon points="0,0 0,26 -24,44 -24,18" />
          <rect
            x="49"
            y="11"
            width="42"
            height="78"
            rx="21"
            fill="none"
            stroke={LOGO_YELLOW}
            strokeWidth="22"
          />
        </g>
      </g>
    </svg>
  );
}
