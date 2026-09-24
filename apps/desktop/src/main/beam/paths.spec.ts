import { describe, expect, it } from 'vitest';
import { beamEnv, beamPaths } from './paths.js';

const HOME = '/home/u';

describe('beamPaths', () => {
  it('uses ~/.config/beam by default', () => {
    expect(beamPaths({}, HOME)).toEqual({
      configDir: '/home/u/.config/beam',
      socket: '/home/u/.config/beam/run/beam.sock',
    });
  });

  it('follows XDG_CONFIG_HOME, then BEAM_CONFIG_DIR over it', () => {
    expect(beamPaths({ XDG_CONFIG_HOME: '/x' }, HOME).configDir).toBe(
      '/x/beam'
    );
    expect(
      beamPaths({ XDG_CONFIG_HOME: '/x', BEAM_CONFIG_DIR: '/b' }, HOME)
    ).toEqual({ configDir: '/b', socket: '/b/run/beam.sock' });
  });

  it('makes a relative directory or socket absolute', () => {
    const paths = beamPaths(
      { BEAM_CONFIG_DIR: 'rel/beam', BEAM_SOCKET: 'b.sock' },
      HOME
    );
    expect(paths.configDir).toBe(`${process.cwd()}/rel/beam`);
    expect(paths.socket).toBe(`${process.cwd()}/b.sock`);
  });
});

describe('beamEnv', () => {
  it('names the directory, and the socket only when one was set', () => {
    expect(beamEnv(beamPaths({}, HOME), {})).toEqual({
      BEAM_CONFIG_DIR: '/home/u/.config/beam',
    });
    expect(
      beamEnv(beamPaths({ BEAM_SOCKET: '/s' }, HOME), { BEAM_SOCKET: '/s' })
    ).toEqual({ BEAM_CONFIG_DIR: '/home/u/.config/beam', BEAM_SOCKET: '/s' });
  });
});
