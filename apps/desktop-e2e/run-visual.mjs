#!/usr/bin/env node
/**
 * Runs the screenshot tests inside a pinned container.
 *
 * Screenshot comparison is only meaningful when the thing rendering the
 * pixels is the same everywhere. It is not: this machine, another
 * developer's, and the CI runner each have their own font packages, and
 * the text they draw differs by a few pixels of antialiasing. That is
 * invisible on a full window and fatal on a dialog — a fixed
 * pixel-*ratio* tolerance is far stricter on a small image, so the same
 * absolute difference passes at 1360x860 and fails at 440x220.
 *
 * Rather than loosening the tolerance until it stops catching real
 * layout breakage, the visual suite runs in one image everywhere, both
 * locally and in CI. Baselines are generated in it too:
 *
 *   node run-visual.mjs                     # compare
 *   node run-visual.mjs --update-snapshots  # regenerate baselines
 *
 * The rest of the e2e suite has no such constraint and runs natively.
 */
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Pin to the Playwright version in package.json — the image ships the
 *  browser system dependencies and fonts that version expects. */
const IMAGE = 'n10-playwright:1.59.1-noble-tmux';

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKSPACE = resolve(HERE, '..', '..');

/** Relative to this project, and matched by the `e2e:visual` target's
 *  nx `outputs` — see playwright.config.ts. */
const OUTPUT_BASE = './test-output/visual';

if (spawnSync('docker', ['info'], { stdio: 'ignore' }).status !== 0) {
  console.error(
    '[desktop-e2e] Docker is required for the visual suite, and is not usable here.\n' +
      '              The screenshots are environment-specific, so running them\n' +
      '              outside the pinned image would compare against baselines\n' +
      '              drawn with different fonts.\n\n' +
      '              Install/start Docker, or skip this suite — `nx e2e desktop-e2e`\n' +
      '              covers everything else and needs no container.'
  );
  process.exit(1);
}

// tmux is part of the application runtime. Build a small derivative of
// the pinned Playwright image; Docker caches the package installation.
const build = spawnSync(
  'docker',
  ['build', '-f', resolve(HERE, 'Dockerfile.visual'), '-t', IMAGE, HERE],
  { stdio: 'inherit' }
);
if (build.status !== 0) process.exit(build.status ?? 1);

const inner = [
  'node',
  'run-e2e.mjs',
  '--grep',
  '@visual',
  ...process.argv.slice(2),
].join(' ');

const res = spawnSync(
  'docker',
  [
    'run',
    '--rm',
    // Chromium needs a real /dev/shm; the default 64MB crashes it.
    '--ipc=host',
    // Write baselines and reports back as the invoking user, not root.
    '--user',
    `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`,
    '-v',
    `${WORKSPACE}:/workspace`,
    '-w',
    '/workspace/apps/desktop-e2e',
    '-e',
    'HOME=/tmp',
    // Its own results directory. Playwright empties the one it is given
    // at the start of a run, and `nx e2e` runs over the same checkout —
    // sharing one means whichever target finishes last deletes the
    // other's traces and screenshot diffs before CI collects them.
    '-e',
    `N10_E2E_OUTPUT_BASE=${OUTPUT_BASE}`,
    IMAGE,
    'bash',
    '-lc',
    inner,
  ],
  { stdio: 'inherit' }
);

process.exit(res.status ?? 1);
