#!/usr/bin/env node
// Rewrites apps/cli/dist/package.json into a minimal, publish-safe package.
// The build copies the source package.json into dist/ (via the build's
// `assets` config) for local use (e.g. `npm install -g ./apps/cli/dist`),
// but that file carries workspace `@n10/*` deps that don't exist on the
// npm registry, plus dev deps and nx config bloat. This strips all of it.

import { execFileSync } from 'node:child_process';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertVersionsMatch } from '../../../scripts/shared-version.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(__dirname, '..');
const distDir = resolve(appDir, 'dist');
const distPkgPath = resolve(distDir, 'package.json');
const src = JSON.parse(readFileSync(distPkgPath, 'utf8'));

// The TUI, the desktop app and beam ship as one release under one version.
assertVersionsMatch();

// npm only picks up a README/LICENSE that sit in the pack root, and the
// pack root is dist/ — without these the npm page is blank and the tarball
// carries no licence text for the MIT it declares.
copyFileSync(resolve(appDir, 'README.md'), resolve(distDir, 'README.md'));
copyFileSync(
  resolve(appDir, '..', '..', 'LICENSE'),
  resolve(distDir, 'LICENSE')
);

// @cwasm/webp is bundled but loads its wasm from disk at runtime — it
// has to sit next to main.js and ship in the tarball.
execFileSync(process.execPath, [resolve(__dirname, 'copy-webp-wasm.mjs')], {
  stdio: 'inherit',
});

// node-pty is the only runtime dep kept external by esbuild (native module).
// Everything else — ink, react, @n10/*, @inkjs/ui, @mishieck/ink-titled-box
// — is bundled into dist/main.js.
const nodePtyVersion = src.dependencies?.['node-pty'];
if (!nodePtyVersion) {
  throw new Error('node-pty missing from source dependencies');
}

const out = {
  name: src.name,
  version: src.version,
  description: src.description,
  author: src.author,
  license: src.license,
  type: src.type,
  bin: src.bin,
  files: ['main.js', 'webp.wasm', 'README.md', 'LICENSE'],
  publishConfig: src.publishConfig,
  engines: src.engines,
  repository: src.repository,
  dependencies: { 'node-pty': nodePtyVersion },
};

writeFileSync(distPkgPath, JSON.stringify(out, null, 2) + '\n');
console.log(
  `Prepared ${distPkgPath} for publish (name=${out.name}@${out.version})`
);
