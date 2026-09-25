#!/usr/bin/env node
// Points the `latest` dist-tag at the version that was just published.
//
// A single `npm publish` can set exactly one tag, and we publish under
// `beta` so the documented `@beta` install path is set the moment the
// version exists. `latest` is a second call, run right after, so a bare
// `npm install -g @notaharness/n10` resolves to the current release too — npm
// otherwise leaves `latest` where it was, and a prerelease version is
// never picked up by a plain install without it.
//
// The name and version come from the package's source manifest rather
// than arguments, so a typo cannot tag a version that was never published.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { name, version } = JSON.parse(
  readFileSync(resolve(appDir, 'package.json'), 'utf8')
);

execFileSync('npm', ['dist-tag', 'add', `${name}@${version}`, 'latest'], {
  stdio: 'inherit',
});
