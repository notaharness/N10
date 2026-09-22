// The one version every published package carries.
//
// `@notaharness/n10` (TUI) and `@notaharness/n10-desktop` are two
// front-ends over the same core, so a user can compare their numbers and
// know what they have. `@notaharness/beam` is a different kind of thing:
// a machine-to-machine transport binary with no UI, and the only way a
// user gets beam at all. It belongs here because the desktop embeds
// `libs/beam` and talks to that standalone binary on the far machine —
// one number across all three says which pairing and stream protocol
// both ends of a connection were cut from. Keeping that true by hand
// doesn't survive contact with a release, so each package's publish-prep
// calls `assertVersionsMatch()` and refuses to prepare a mismatched set.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const PACKAGES = [
  { label: 'TUI', path: 'apps/cli/package.json' },
  { label: 'desktop', path: 'apps/desktop/package.json' },
  { label: 'beam', path: 'apps/beam/package.json' },
];

function readVersion(relPath) {
  return JSON.parse(readFileSync(resolve(root, relPath), 'utf8')).version;
}

/**
 * Throws unless every published package declares the same version.
 * Returns that version.
 */
export function assertVersionsMatch() {
  const found = PACKAGES.map((p) => ({ ...p, version: readVersion(p.path) }));
  const [first, ...rest] = found;
  const mismatch = rest.find((p) => p.version !== first.version);
  if (mismatch) {
    const list = found
      .map((p) => `  ${p.version}  ${p.label} (${p.path})`)
      .join('\n');
    throw new Error(
      `The TUI, desktop and beam versions must match — they ship as one release.\n${list}\n` +
        `Set them all to the same version, commit, then publish.`
    );
  }
  return first.version;
}
