import { describe, expect, it, vi } from 'vitest';

const toString = vi.hoisted(() => vi.fn());
vi.mock('qrcode', () => ({ default: { toString } }));

const { renderPairingQr } = await import('./qr.js');

describe('renderPairingQr', () => {
  it('renders as an SVG string, via the qrcode package, at the requested size', async () => {
    toString.mockResolvedValue('<svg>ok</svg>');
    const svg = await renderPairingQr('http://x/pair#token=y', { size: 180 });
    expect(svg).toBe('<svg>ok</svg>');
    expect(toString).toHaveBeenCalledWith(
      'http://x/pair#token=y',
      expect.objectContaining({ type: 'svg', width: 180 })
    );
  });

  it('keeps a quiet-zone margin so a camera can lock on', async () => {
    toString.mockResolvedValue('<svg/>');
    await renderPairingQr('http://x/pair#token=y', { size: 180 });
    const opts = toString.mock.calls[0][1] as { margin: number };
    expect(opts.margin).toBeGreaterThan(0);
  });

  it('never asks for a canvas renderer or a network-backed type', async () => {
    toString.mockResolvedValue('<svg/>');
    await renderPairingQr('http://x/pair#token=y', { size: 180 });
    const opts = toString.mock.calls[0][1] as { type: string };
    expect(opts.type).toBe('svg');
  });

  it('propagates a library failure rather than resolving with nothing', async () => {
    toString.mockRejectedValue(new Error('bad input'));
    await expect(renderPairingQr('not a url', { size: 180 })).rejects.toThrow(
      'bad input'
    );
  });
});
