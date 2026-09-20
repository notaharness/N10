import type { CSSProperties } from 'react';
import { cn } from '@/lib/cn';

/**
 * The mark's idea at page scale. The logo is a sage pane and a sand pane
 * that mix to olive where they overlap; here sage light comes in from
 * the left, sand from the right, and they meet behind the hero's mark.
 * Over that, a fine grid carries a handful of tinted cells — single
 * panes, and pairs where a sand cell sits half a column over a sage one
 * and splits into the same three stripes as the N's shared stave.
 *
 * Everything is positioned from the horizontal centre (`50%` plus a
 * whole number of cells), so the composition is the same at every
 * viewport width and just gets cropped by narrower ones. Rows and
 * columns are cell indices: column 0 straddles the centre line, row 0
 * touches the top edge. The middle columns stay empty below row 0 —
 * that's where the hero's copy goes.
 */
const CELL = 56;

type Tone = 'sage' | 'sand' | 'pair';

interface Cell {
  col: number;
  row: number;
  tone: Tone;
  /** Breathes slowly; staggered by index. Off under reduced motion. */
  pulse?: boolean;
}

const cells: Cell[] = [
  { col: -11, row: 0, tone: 'sage' },
  { col: -10, row: 1, tone: 'pair', pulse: true },
  { col: -12, row: 2, tone: 'sand' },
  { col: -8, row: 4, tone: 'sage', pulse: true },
  { col: -5, row: 0, tone: 'sand' },
  { col: 4, row: 0, tone: 'sage', pulse: true },
  { col: 7, row: 4, tone: 'sand' },
  { col: 8, row: 1, tone: 'pair' },
  { col: 10, row: 0, tone: 'sage' },
  { col: 11, row: 2, tone: 'sand', pulse: true },
];

function cellStyle({ col, row }: Cell, i: number): CSSProperties {
  return {
    left: `calc(50% - ${CELL / 2}px + ${col * CELL}px)`,
    top: row * CELL,
    height: CELL,
    animationDelay: `${i * -1.3}s`,
  };
}

const grid: CSSProperties = {
  backgroundImage:
    'linear-gradient(to right, var(--color-fd-border) 1px, transparent 1px), linear-gradient(to bottom, var(--color-fd-border) 1px, transparent 1px)',
  backgroundSize: `${CELL}px ${CELL}px`,
  backgroundPosition: 'calc(50% + 0.5px) -1px',
  maskImage:
    'radial-gradient(ellipse 75% 90% at 50% 0%, black 25%, transparent 78%)',
};

export function HeroBackdrop({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        'n10-backdrop pointer-events-none absolute inset-x-0 top-0 h-[620px] overflow-hidden',
        className
      )}
    >
      <div className="n10-backdrop-glow n10-backdrop-glow--sage" />
      <div className="n10-backdrop-glow n10-backdrop-glow--sand" />
      <div className="absolute inset-0" style={grid} />
      <div className="absolute inset-0 max-sm:hidden">
        {cells.map((cell, i) => (
          <div
            key={`${cell.col}:${cell.row}`}
            className={cn(
              'n10-backdrop-cell',
              `n10-backdrop-cell--${cell.tone}`,
              cell.pulse && 'n10-backdrop-cell--pulse'
            )}
            style={cellStyle(cell, i)}
          />
        ))}
      </div>
    </div>
  );
}
