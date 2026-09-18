import QRCode from 'qrcode';

export interface QrOptions {
  /** Pixel width/height of the rendered code (square). */
  size: number;
}

/**
 * Render `value` (the pairing URL) as an SVG string — no canvas, no
 * network fetch, per the UX spec. `qrcode`'s SVG renderer is pure
 * computation over the input string, so this is safe to call for a
 * bearer-token URL without it ever leaving the machine. `margin: 2`
 * keeps the quiet zone the UX spec asks for so a phone camera can lock
 * on at arm's length.
 */
export function renderPairingQr(
  value: string,
  options: QrOptions
): Promise<string> {
  return QRCode.toString(value, {
    type: 'svg',
    margin: 2,
    width: options.size,
    color: { dark: '#000000', light: '#ffffff' },
  });
}
