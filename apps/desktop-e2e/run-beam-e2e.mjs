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
  version: '0.1.0-beta.3',
  sha256: {
    'beamtest-darwin-amd64':
      '6a8de7060c996ba80d46ccdd6d5c62c9bd23aa0e1c379565921af6fbca3ec38b',
    'beamtest-darwin-arm64':
      'e62f342794e275b87216fd4072fa61116995fd910ee094c1aa9c78652d3e07fb',
    'beamtest-linux-amd64':
      '03175fded3e18c34421a2ace67227aeb3ed4923310b7518e7f4da72a91e4b1ee',
    'beamtest-linux-arm64':
      'ae1cfad03110bdfadb8531ee1d5a58e10f50f7c4b8a1e77a62444d9add596547',
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
