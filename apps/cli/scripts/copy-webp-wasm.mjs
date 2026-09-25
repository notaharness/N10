#!/usr/bin/env node
// @cwasm/webp reads webp.wasm from its own directory at runtime, and it
// is bundled into the CLI's chunks — so the wasm has to sit next to the
// bundle. Nx's esbuild asset copying can't reach into node_modules, so
// this does it. Run by `prepare-publish`.
import { copyFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const src = resolve(
  dirname(require.resolve('@cwasm/webp/package.json')),
  'webp.wasm'
);
const dest = resolve(here, '../dist/webp.wasm');
copyFileSync(src, dest);
console.log(`Copied webp.wasm → ${dest}`);
