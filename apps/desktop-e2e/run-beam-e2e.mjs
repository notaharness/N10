#!/usr/bin/env node
/**
 * Resolves a beamtest binary (BEAM_TEST_BINARY, or the release asset
 * matching `@notaharness/beam`, checked against the checksums pinned
 * below) and runs the `@beam` tests; see docs/testing.md.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const RELEASES = 'https://github.com/notaharness/beam/releases/download';

/** The beamtest assets of the beam release the desktop depends on, from
 *  its SHA256SUMS. Bumping `@notaharness/beam` means replacing these. */
const PINNED = {
  version: '0.1.0-beta.2',
  sha256: {
    'beamtest-darwin-amd64':
      'dc46f5c6a4afc30805c2c1955408382fb053e453795fb00cb232e23b148e2cb7',
    'beamtest-darwin-arm64':
      '129e1ceeaabea8d090b82f209d0f7121be70114555ac58b9af79ae1ffd3953a5',
    'beamtest-linux-amd64':
      '22916c26689187a59b68d355bca75d01ed5c5eadcc8f559effa3e8c0fd905bee',
    'beamtest-linux-arm64':
      '54ab83721d007a95169f1d68cc177742638122f47db091ad0aac1820a2de19de',
  },
};

function assetName() {
  const arch = { x64: 'amd64', arm64: 'arm64' }[process.arch];
  if (!['linux', 'darwin'].includes(process.platform) || !arch) {
    throw new Error(
      `beam publishes no beamtest for ${process.platform}/${process.arch}`
    );
  }
  return `beamtest-${process.platform}-${arch}`;
}

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function releasedBinary() {
  const require = createRequire(join(here, '../desktop/package.json'));
  const { version } = require('@notaharness/beam/package.json');
  if (version !== PINNED.version) {
    throw new Error(
      `@notaharness/beam is ${version}, but run-beam-e2e.mjs pins beamtest checksums for ${PINNED.version}`
    );
  }
  const name = assetName();
  const path = resolve(
    here,
    '../../node_modules/.cache/beamtest',
    version,
    name
  );
  if (existsSync(path)) return path;

  const binary = await download(`${RELEASES}/v${version}/${name}`);
  const got = createHash('sha256').update(binary).digest('hex');
  if (got !== PINNED.sha256[name]) {
    throw new Error(
      `${name} of v${version}: sha256 ${got}, pinned ${PINNED.sha256[name]}`
    );
  }

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.part`, binary, { mode: 0o755 });
  renameSync(`${path}.part`, path);
  return path;
}

const binary =
  process.env.BEAM_TEST_BINARY ??
  (await releasedBinary().catch((err) => {
    throw new Error(
      `no beamtest binary (${err.message}); set BEAM_TEST_BINARY to the absolute path of a \`go build -tags beamtest\` of beam`
    );
  }));

const res = spawnSync(
  process.execPath,
  [join(here, 'run-e2e.mjs'), '--grep', '@beam', ...process.argv.slice(2)],
  {
    stdio: 'inherit',
    env: { ...process.env, BEAM_TEST_BINARY: binary },
  }
);
process.exit(res.status ?? 1);
