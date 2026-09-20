#!/usr/bin/env node
// Rewrites apps/beam/dist/package.json into a minimal, publish-safe package.
// The build copies the source package.json into dist/ (via the build's
// `assets` config) for local use (e.g. `npm install -g ./apps/beam/dist`),
// but that file carries nx target config, and the dist directory also
// accumulates declaration output and `prune` artifacts. A `files` allowlist
// plus a stripped manifest keeps the tarball to the bundle and its one
// native dependency.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertVersionsMatch } from '../../../scripts/shared-version.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distPkgPath = resolve(__dirname, '../dist/package.json');
const src = JSON.parse(readFileSync(distPkgPath, 'utf8'));

// beam ships in the same release as the TUI and the desktop app.
assertVersionsMatch();

// node-pty is the only runtime dep kept external by esbuild (native module).
// Everything else — @n10/beam included — is bundled into dist/main.js, and a
// private workspace package named in `dependencies` makes the tarball
// uninstallable because npm cannot resolve it from the registry.
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
  files: ['main.js'],
  publishConfig: src.publishConfig,
  engines: src.engines,
  repository: src.repository,
  dependencies: { 'node-pty': nodePtyVersion },
};

writeFileSync(distPkgPath, JSON.stringify(out, null, 2) + '\n');
console.log(
  `Prepared ${distPkgPath} for publish (name=${out.name}@${out.version})`
);
