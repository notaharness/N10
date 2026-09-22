import { describe, expect, it } from 'vitest';
import { resolveBeamDir } from './beam-dir.js';

describe('resolveBeamDir', () => {
  it('prefers BEAM_CONFIG_DIR over everything else', () => {
    const dir = resolveBeamDir({
      BEAM_CONFIG_DIR: '/custom/beam',
      XDG_CONFIG_HOME: '/xdg',
      HOME: '/home/u',
    });
    expect(dir).toBe('/custom/beam');
  });

  it('falls back to XDG_CONFIG_HOME/beam', () => {
    const dir = resolveBeamDir({ XDG_CONFIG_HOME: '/xdg', HOME: '/home/u' });
    expect(dir).toBe('/xdg/beam');
  });

  it('falls back to ~/.config/beam when nothing else is set', () => {
    const dir = resolveBeamDir({ HOME: '/home/u' });
    expect(dir).toBe('/home/u/.config/beam');
  });

  it('throws when no home directory can be found', () => {
    expect(() => resolveBeamDir({})).toThrow();
  });
});
