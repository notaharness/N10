#!/usr/bin/env node
// Builds the Linux installers, a .deb and an AppImage, for this
// machine's architecture into dist/installers. Run by the
// `package-linux` target, after the desktop build.
//
// The app directory keeps the npm package's layout (desktop/main finds
// preload/ and renderer/ beside it) and version. Its node_modules holds
// what the desktop loads at runtime, copied from this workspace's
// install: node-pty with the addon built here, and beam with the one
// platform package npm installed for this machine, so a package built
// on x64 holds the x64 binary alone.

import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'linux') {
  throw new Error('package-linux builds on Linux only');
}

const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const appDir = resolve(desktopDir, 'dist', 'installer-app');
const require = createRequire(import.meta.url);
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const cli = readJson(resolve(desktopDir, '..', 'cli', 'package.json'));

rmSync(appDir, { recursive: true, force: true });
for (const part of ['main', 'preload', 'renderer']) {
  const from = resolve(desktopDir, 'dist', part);
  if (!existsSync(from)) {
    throw new Error(`${from} is missing; build the desktop first`);
  }
  cpSync(from, resolve(appDir, 'desktop', part), {
    recursive: true,
    filter: (path) => !path.endsWith('.map'),
  });
}

/** Copies an installed package, and returns its version. */
function copyPackage(name, filter = () => true) {
  const from = dirname(require.resolve(`${name}/package.json`));
  cpSync(from, resolve(appDir, 'node_modules', name), {
    recursive: true,
    dereference: true,
    filter: (path) => filter(relative(from, path)),
  });
  return readJson(resolve(from, 'package.json')).version;
}

const platform = `${process.platform}-${process.arch}`;
// node-pty's sources and other platforms' prebuilds are not loaded.
const ptyRuntime = (path) =>
  !/^(src|deps|third_party|scripts)(\/|$)/.test(path) &&
  !/\.(map|test\.js)$/.test(path) &&
  !(path.startsWith('prebuilds/') && !path.startsWith(`prebuilds/${platform}`));
const dependencies = {
  'node-pty': copyPackage('node-pty', ptyRuntime),
  '@notaharness/beam': copyPackage('@notaharness/beam'),
};
copyPackage('node-addon-api');
copyPackage(`@notaharness/beam-${platform}`);

writeFileSync(
  resolve(appDir, 'package.json'),
  JSON.stringify(
    {
      name: 'n10',
      productName: 'n10',
      // Electron's app_id and WM_CLASS on Linux, linking windows to the entry.
      desktopName: 'n10.desktop',
      version: cli.version,
      description: cli.description,
      author: { name: 'Hermann Björgvin', email: 'hermann@hermann.is' },
      homepage: 'https://github.com/notaharness/n10',
      license: cli.license,
      type: 'module',
      main: 'desktop/main/main.js',
      dependencies,
    },
    null,
    2
  ) + '\n'
);

execFileSync(
  'npx',
  [
    'electron-builder',
    '--linux',
    `--${process.arch}`,
    '--publish',
    'never',
    `-c.electronVersion=${
      readJson(require.resolve('electron/package.json')).version
    }`,
  ],
  { cwd: desktopDir, stdio: 'inherit' }
);
