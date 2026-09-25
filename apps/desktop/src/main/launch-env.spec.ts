import { describe, expect, it } from 'vitest';
import {
  appIdentity,
  launchStartDir,
  loginShellPath,
  mergePath,
  pathFromEnvOutput,
} from './launch-env.js';

describe('appIdentity', () => {
  it('reports the manifest version for the npm package and installers', () => {
    expect(appIdentity('n10', '1.2.0', {})).toEqual({
      version: '1.2.0',
      isDev: false,
    });
  });

  it('marks the dev build by its manifest name', () => {
    expect(appIdentity('n10-dev', '0.0.1', {})).toEqual({
      version: 'dev',
      isDev: true,
    });
  });

  it('takes a test label from N10_DESKTOP_VERSION without the dev menu', () => {
    expect(
      appIdentity('n10-dev', '0.0.1', { N10_DESKTOP_VERSION: 'e2e' })
    ).toEqual({ version: 'e2e', isDev: false });
  });

  it('is dev whenever the Vite dev server is in use', () => {
    expect(
      appIdentity('n10', '1.2.0', { N10_VITE_URL: 'http://localhost:5173' })
        .isDev
    ).toBe(true);
  });
});

describe('launchStartDir', () => {
  const base = {
    env: {},
    argv: ['/opt/n10/n10-desktop'],
    cwd: '/home/u/repo',
    packaged: true,
    fromTerminal: true,
  };

  it('prefers N10_START_DIR, empty meaning none', () => {
    expect(launchStartDir({ ...base, env: { N10_START_DIR: '/r' } })).toBe(
      '/r'
    );
    expect(
      launchStartDir({ ...base, env: { N10_START_DIR: '' } })
    ).toBeUndefined();
  });

  it('opens the last path argument, relative to the cwd', () => {
    expect(
      launchStartDir({
        ...base,
        argv: ['/opt/n10/n10-desktop', '--no-sandbox', 'sub', '../other'],
      })
    ).toBe('/home/u/other');
  });

  it('opens the cwd of a terminal launch, not of a menu launch', () => {
    expect(launchStartDir(base)).toBe('/home/u/repo');
    expect(launchStartDir({ ...base, fromTerminal: false })).toBeUndefined();
  });

  it('leaves an unpackaged run to N10_START_DIR alone', () => {
    expect(
      launchStartDir({ ...base, packaged: false, argv: ['electron', '.'] })
    ).toBeUndefined();
  });
});

describe('login shell PATH', () => {
  it('reads PATH between the marks, ignoring startup output', () => {
    const out =
      'PATH=/noise\n__N10_LOGIN_ENV__\nPATH=/a:/b\nHOME=/h\n__N10_LOGIN_ENV__';
    expect(pathFromEnvOutput(out)).toBe('/a:/b');
    expect(pathFromEnvOutput('PATH=/a')).toBeUndefined();
  });

  it('puts the shell PATH first and keeps the rest', () => {
    expect(mergePath('/a:/usr/bin', '/usr/bin:/bin:')).toBe('/a:/usr/bin:/bin');
  });

  it('runs the shell as a login shell', async () => {
    expect(await loginShellPath('/bin/sh')).toMatch(/\/bin/);
    expect(await loginShellPath('/nonexistent/shell')).toBeUndefined();
  });
});
