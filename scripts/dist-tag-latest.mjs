#!/usr/bin/env node
// Points the `latest` dist-tag at the version that was just published.
//
// A single `npm publish` can set exactly one tag, and we publish under
// `beta` so the documented `@beta` install path is set the moment the
// version exists. `latest` is a second call, run right after, so a bare
// `npm install -g <pkg>` resolves to the current release too — npm
// otherwise leaves `latest` where it was, and a prerelease version is
// never picked up by a plain install without it.
//
// The version comes from assertVersionsMatch() rather than an argument:
// the packages ship as one release, and re-deriving the number here
// would let a typo tag a version that was never published.

import { execFileSync } from 'node:child_process';
import { assertVersionsMatch } from './shared-version.mjs';

const pkg = process.argv[2];
if (!pkg) {
  throw new Error('usage: dist-tag-latest.mjs <package-name>');
}

const version = assertVersionsMatch();

execFileSync('npm', ['dist-tag', 'add', `${pkg}@${version}`, 'latest'], {
  stdio: 'inherit',
});
