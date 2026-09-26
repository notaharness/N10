import type { CSSProperties } from 'react';
import { cn } from '@/lib/cn';

/**
 * The mark's idea at page scale. The logo is a sage pane and a sand pane
 * that mix to olive where they overlap; here sage light comes in from
 * the left, sand from the right, and they meet behind the hero's mark.
 * Over that, a fine grid carries a handful of tinted cells — single
 * panes, and pairs where a sand cell sits half a column over a sage one
 * and splits into the same three stripes as the n's shared stem.
 *
 * The grid's cell is `--n10-cell` (global.css), which is also the module
 * the hero sizes its mark by, so the mark's strokes are grid cells.
 * Everything is positioned from the horizontal centre (`50%` plus a
 * whole number of cells), so the composition is the same at every
 * viewport width and just gets cropped by narrower ones. Rows and
 * columns are cell indices: column 0 straddles the centre line, row 0
 * touches the top edge. Columns -3 to 4 stay empty below row 0 — that
 * is where the mark sits and where it splits to.
 */
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
    '--col': col,
    '--row': row,
    animationDelay: `${i * -1.3}s`,
  } as CSSProperties;
}

export function HeroBackdrop({
  cells: showCells = true,
  className,
}: {
  /** Off for short, contained uses where the clusters would be cropped. */
  cells?: boolean;
  className?: string;
}) {
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
      <div className="n10-backdrop-grid absolute inset-0" />
      {showCells && (
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
      )}
    </div>
  );
}
