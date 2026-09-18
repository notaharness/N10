import type { LogoColors } from '@/components/logo';

/**
 * Candidate pane pairs. Multiply blending only gives a clean third colour
 * when the two share a channel, so every pair here is two of the
 * subtractive primaries (cyan / magenta / yellow) or a near neighbour;
 * the mix column is the real product the browser will paint.
 */
export const PALETTES: { name: string; note: string; colors: LogoColors }[] = [
  {
    name: 'Azure / Yellow',
    note: 'Current. Sky and sun; mixes to a leaf green.',
    colors: { n: '#2ba3ff', ten: '#ffd93d' },
  },
  {
    name: 'Cyan / Magenta',
    note: 'The print primaries; mixes to a deep indigo blue.',
    colors: { n: '#33d6ff', ten: '#ff5fb8' },
  },
  {
    name: 'Magenta / Yellow',
    note: 'Warm and loud; mixes to a red-orange.',
    colors: { n: '#ff5fb8', ten: '#ffd93d' },
  },
  {
    name: 'Violet / Pink',
    note: 'One family, two tints; mixes to a saturated purple.',
    colors: { n: '#7c6cff', ten: '#ff8fd8' },
  },
  {
    name: 'Brand blue / Amber',
    note: "The desktop's accent blue; darker, mixes to a forest green.",
    colors: { n: '#0078d4', ten: '#ffb830' },
  },
  {
    name: 'Red / Cyan',
    note: 'Anaglyph glasses. True complements, so the overlap goes to black — exactly what stacked 3D filters do.',
    colors: { n: '#ff2222', ten: '#18e0e0' },
  },
];

function channel(hex: string, i: number): number {
  return parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
}

/** The multiply product of two hex colours, as the browser will paint it. */
export function multiply(a: string, b: string): string {
  const hex = [0, 1, 2]
    .map((i) => Math.round((channel(a, i) * channel(b, i)) / 255))
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('');
  return `#${hex}`;
}

export function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-xs">
      <span
        className="inline-block size-3 rounded-sm border border-fd-border"
        style={{ background: color }}
      />
      {label} {color}
    </span>
  );
}
