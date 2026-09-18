import { useEffect, useState } from 'react';
import { renderPairingQr } from '../../lib/machines/qr.js';

/**
 * The pairing URL as a scannable code — an SVG string rendered by the
 * `qrcode` package (no canvas, no network), white-boxed so it scans in
 * both themes. `size` is the code's own edge; the white box adds a
 * fixed quiet-zone margin around it, per the UX spec's "large enough to
 * scan from a phone at arm's length (min 180px, quiet zone included)".
 */
export function QrCode({
  value,
  size = 180,
}: {
  value: string;
  size?: number;
}) {
  const [svg, setSvg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // The previous code (if any) stays visible until the new one is
    // ready, rather than flashing empty on every value/size change.
    renderPairingQr(value, { size }).then(
      (result) => {
        if (!cancelled) setSvg(result);
      },
      () => {
        if (!cancelled) setSvg(null);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [value, size]);

  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-md bg-white p-3"
      style={{ width: size + 24, height: size + 24 }}
    >
      {svg ? (
        <div
          role="img"
          aria-label="Scan to pair with this machine"
          // The qrcode package's own SVG output, not user content.
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : null}
    </div>
  );
}
