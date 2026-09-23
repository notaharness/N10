import { useMemo } from 'react';
import { encode } from 'uqr';

/** One path of unit squares, one per dark module. */
function modulesPath(data: boolean[][]): string {
  const parts: string[] = [];
  data.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) parts.push(`M${x} ${y}h1v1h-1z`);
    })
  );
  return parts.join('');
}

/**
 * `value` as a QR code a phone can scan, at error correction level L
 * with a four-module quiet zone, as beam's CLI draws a ceremony URL
 * (beam docs/07). Black on white whatever the theme — the one place
 * the design tokens do not apply: scanners read dark modules on a
 * light field.
 */
const SIZE = 176;

export function QrCode({ value }: { value: string }) {
  const { n, path } = useMemo(() => {
    const { data } = encode(value, { ecc: 'L', border: 4 });
    return { n: data.length, path: modulesPath(data) };
  }, [value]);
  return (
    <svg
      role="img"
      aria-label="QR code of the passkey link"
      viewBox={`0 0 ${n} ${n}`}
      width={SIZE}
      height={SIZE}
      shapeRendering="crispEdges"
      className="shrink-0 rounded-sm"
    >
      <rect width={n} height={n} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
