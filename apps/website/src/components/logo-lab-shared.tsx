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

  // Loud. These lean into complements or clashing saturation on purpose —
  // the mix goes dark or muddy, and that's the point.
  {
    name: 'Neon / Acid',
    note: 'As loud as it gets. Safety-vest green against radioactive red — the mix is almost incidental here.',
    colors: { n: '#39ff14', ten: '#ff073a' },
  },
  {
    name: 'Vaporwave',
    note: 'Pink and cyan on a retro grid; mixes to a rich electric blue.',
    colors: { n: '#ff6ec7', ten: '#01cdfe' },
  },

  // Subtle. Close in lightness and saturation, so the mark reads as one
  // calm object rather than two panes shouting over each other.
  {
    name: 'Sage / Sand',
    note: 'Muted and earthy; mixes to a quiet olive.',
    colors: { n: '#9caf88', ten: '#e3c16f' },
  },
  {
    name: 'Blush / Powder',
    note: 'Pastel pink and pastel blue; mixes to a soft dusty lavender.',
    colors: { n: '#f7cad0', ten: '#bde0fe' },
  },
  {
    name: 'Midnight / Gold',
    note: 'Deep navy and gold, for a more formal reading; the navy is dark enough that the overlap reads as near-black.',
    colors: { n: '#1b263b', ten: '#d4af37' },
  },

  // Programmer culture.
  {
    name: 'Monokai',
    note: "The Monokai editor theme's two loudest accents, pink and green.",
    colors: { n: '#f92672', ten: '#a6e22e' },
  },
  {
    name: 'Solarized',
    note: "Solarized's blue and yellow; mixes to a muted olive-green.",
    colors: { n: '#268bd2', ten: '#b58900' },
  },
  {
    name: 'Phosphor / Amber',
    note: 'Green-phosphor and amber CRT monitors, side by side.',
    colors: { n: '#00ff66', ten: '#ffb000' },
  },
  {
    name: 'Coffee & Cream',
    note: 'Espresso and steamed milk; the mix is a warm latte brown.',
    colors: { n: '#6f4e37', ten: '#f3e5ab' },
  },

  // More editor themes.
  {
    name: 'Gruvbox',
    note: "Gruvbox's orange and aqua; mixes to a warm olive-brown.",
    colors: { n: '#fe8019', ten: '#8ec07c' },
  },
  {
    name: 'Nord',
    note: "Nord's frost blue and aurora orange; mixes to a quiet taupe.",
    colors: { n: '#88c0d0', ten: '#d08770' },
  },
  {
    name: 'Dracula',
    note: "Dracula's pink and green; mixes to a muted forest.",
    colors: { n: '#ff79c6', ten: '#50fa7b' },
  },
  {
    name: 'Tokyo Night',
    note: 'Blue and orange from the Tokyo Night theme; mixes to a warm mauve.',
    colors: { n: '#7aa2f7', ten: '#ff9e64' },
  },

  // Pop culture.
  {
    name: 'Game Boy',
    note: "Two shades of the original DMG's four-tone green LCD — a single-hue mark by construction, not by choice.",
    colors: { n: '#306230', ten: '#9bbc0f' },
  },
  {
    name: 'Cyberpunk',
    note: 'A loud yellow and hot red-pink; mixes to a saturated red — night-city-billboard colours.',
    colors: { n: '#fcee0a', ten: '#ff003c' },
  },
  {
    name: 'Miami Nights',
    note: 'Synthwave pink and cyan; mixes to a deep indigo, like the two panes are lit by the same neon grid.',
    colors: { n: '#ff2079', ten: '#00f0ff' },
  },

  // Elegant.
  {
    name: 'Royal',
    note: 'Burgundy and gold; the overlap reads as a deep garnet.',
    colors: { n: '#800020', ten: '#ffd700' },
  },
  {
    name: 'Tropical',
    note: 'Teal and coral; mixes to a dark ocean green.',
    colors: { n: '#008080', ten: '#ff7f50' },
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
