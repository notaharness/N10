#!/usr/bin/env node
// Builds apps/desktop/dist into a minimal, publishable package
// (consumed by the `install-global` and `publish` targets):
//   - copies the launcher (bin entry), README and LICENSE to dist/
//   - writes a distilled package.json
//
// The installed app needs exactly two runtime deps: electron (the
// binary the launcher spawns) and node-pty (kept external by esbuild
// because it's native). Everything else is bundled.
//
// node-pty is N-API based, so its prebuilt binaries load in Electron
// as they do in Node — no @electron/rebuild step on the user's machine.
// It ships prebuilds for macOS and Windows only; on Linux npm compiles
// it, which needs python3 and a C++ toolchain (see the README).

import {
  chmodSync,
  copyFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertVersionsMatch } from '../../../scripts/shared-version.mjs';

// The desktop app and the TUI ship as one release under one version.
assertVersionsMatch();

const __dirname = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(__dirname, '..');
const distDir = resolve(appDir, 'dist');

copyFileSync(
  resolve(appDir, 'scripts', 'launcher.mjs'),
  resolve(distDir, 'launcher.mjs')
);
// npm only picks up a README/LICENSE that sit in the pack root, and
// the pack root is dist/ — without these the npm page is blank.
copyFileSync(resolve(appDir, 'README.md'), resolve(distDir, 'README.md'));
const licenseSrc = resolve(appDir, '..', '..', 'LICENSE');
if (existsSync(licenseSrc)) {
  copyFileSync(licenseSrc, resolve(distDir, 'LICENSE'));
}

const src = JSON.parse(readFileSync(resolve(appDir, 'package.json'), 'utf8'));

const electronVersion = src.devDependencies?.electron;
const nodePtyVersion =
  src.dependencies?.['node-pty'] ?? src.devDependencies?.['node-pty'];
if (!electronVersion) {
  throw new Error('electron version not found in source package.json');
}

const out = {
  name: '@notaharness/n10-desktop',
  version: src.version,
  description: src.description,
  author: src.author,
  license: src.license,
  type: 'module',
  // Scoped packages publish as restricted unless told otherwise.
  publishConfig: { access: 'public' },
  keywords: [
    'electron',
    'git-worktree',
    'code-review',
    'claude-code',
    'ai-agent',
  ],
  // Explicit file list — without it npm pack honors the repo's
  // .gitignore, which excludes everything we ship. Paths are relative
  // to the pack root (dist/ itself).
  files: ['main/', 'preload/', 'renderer/', 'launcher.mjs'],
  main: 'main/main.js',
  bin: {
    'n10-desktop': 'launcher.mjs',
  },
  engines: src.engines,
  repository: src.repository,
  dependencies: {
    electron: electronVersion,
    ...(nodePtyVersion ? { 'node-pty': nodePtyVersion } : {}),
  },
};

writeFileSync(
  resolve(distDir, 'package.json'),
  JSON.stringify(out, null, 2) + '\n'
);
// The bin entry has to be executable in the packed tarball, so set it
// before packing rather than at install time.
chmodSync(resolve(distDir, 'launcher.mjs'), 0o755);

// Pack a tarball: `npm install -g <folder>` only symlinks the folder
// and skips installing dependencies; installing the tarball performs
// a real dependency install (electron + node-pty).
// The scope makes npm name the tarball `<scope>-<name>-<version>.tgz`.
for (const f of readdirSync(distDir)) {
  if (/n10-desktop-.*\.tgz$/.test(f)) {
    rmSync(resolve(distDir, f));
  }
}
const tarball = execSync('npm pack', { cwd: distDir, encoding: 'utf8' })
  .trim()
  .split('\n')
  .pop();
console.log(`[desktop] dist prepared for global install: ${tarball}`);
