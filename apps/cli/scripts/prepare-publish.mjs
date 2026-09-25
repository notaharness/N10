#!/usr/bin/env node
// Turns apps/cli/dist into the publishable `@notaharness/n10` package:
// the `n10` executable (main.js and its chunks) with the desktop app's
// build under desktop/. `install-global` and the Package and Release
// workflows pack it.
//
// The build copies the source package.json into dist/, carrying
// workspace `@n10/*` deps that don't exist on the npm registry, dev deps
// and nx config. This writes a manifest with the runtime deps only:
//   - node-pty, native, so external to both bundles. N-API based, so
//     one build loads in Node and Electron alike. Linux installs compile
//     it (see the README).
//   - electron, the binary `n10` launches the desktop app with.
//   - @notaharness/beam, whose platform package holds the `beam` binary
//     the desktop runs as its daemon.
// Everything else is bundled.

import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(__dirname, '..');
const distDir = resolve(appDir, 'dist');
const desktopDir = resolve(appDir, '..', 'desktop');

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const cli = readJson(resolve(appDir, 'package.json'));
const desktop = readJson(resolve(desktopDir, 'package.json'));

function requireVersion(name, version) {
  if (!version) throw new Error(`${name} version not found`);
  return version;
}

// npm only picks up a README that sits in the pack root, and the pack
// root is dist/ — without it the npm page is blank.
copyFileSync(resolve(appDir, 'README.md'), resolve(distDir, 'README.md'));

// @cwasm/webp is bundled but loads its wasm from its own directory at
// runtime — it has to sit next to the chunks and ship in the tarball.
// Nx's esbuild asset copying can't reach into node_modules.
const webp = createRequire(import.meta.url).resolve('@cwasm/webp/package.json');
copyFileSync(
  resolve(dirname(webp), 'webp.wasm'),
  resolve(distDir, 'webp.wasm')
);

// The desktop app keeps its build layout: main/ finds preload/ and
// renderer/ beside it.
rmSync(resolve(distDir, 'desktop'), { recursive: true, force: true });
for (const part of ['main', 'preload', 'renderer']) {
  const from = resolve(desktopDir, 'dist', part);
  if (!existsSync(from)) {
    throw new Error(`${from} is missing; build the desktop first`);
  }
  cpSync(from, resolve(distDir, 'desktop', part), {
    recursive: true,
    filter: (path) => !path.endsWith('.map'),
  });
}

const out = {
  name: cli.name,
  version: cli.version,
  description: cli.description,
  author: cli.author,
  license: cli.license,
  type: 'module',
  // Electron names the app, and its userData directory, after this.
  productName: cli.productName,
  keywords: cli.keywords,
  // Electron's entry: `n10` runs Electron on this directory.
  main: 'desktop/main/main.js',
  bin: cli.bin,
  // Explicit list: without it npm pack honors the repo's .gitignore,
  // which excludes everything we ship.
  files: ['*.js', 'webp.wasm', 'desktop/'],
  publishConfig: cli.publishConfig,
  engines: cli.engines,
  repository: cli.repository,
  dependencies: {
    electron: requireVersion('electron', desktop.devDependencies?.electron),
    'node-pty': requireVersion('node-pty', cli.dependencies?.['node-pty']),
    '@notaharness/beam': requireVersion(
      '@notaharness/beam',
      desktop.dependencies?.['@notaharness/beam']
    ),
  },
};

writeFileSync(
  resolve(distDir, 'package.json'),
  JSON.stringify(out, null, 2) + '\n'
);
// The bin entry has to be executable in the packed tarball.
chmodSync(resolve(distDir, 'main.js'), 0o755);
console.log(`Prepared ${distDir} (${out.name}@${out.version})`);
