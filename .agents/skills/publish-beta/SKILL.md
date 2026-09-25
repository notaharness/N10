---
name: publish-beta
description: Publish the n10 npm package at a new beta version. Use only when the user requests a release.
disable-model-invocation: true
---

# Publish a beta

Publish only when the user asks. n10 is one package, `@notaharness/n10`
(`apps/cli`), which carries the desktop app too. CI publishes it: pushing a
`vX.Y.Z` tag runs `.github/workflows/release.yml`, which packs the package,
installs and runs the tarball in a clean container, publishes that tarball to
npm through trusted publishing with provenance, and creates the GitHub
release with generated notes. No npm login or token is involved.

1. Check the worktree and the current version in `apps/cli/package.json`
   against `npm view @notaharness/n10 versions --json`. If that version is
   unpublished, release it as is; otherwise choose the next `-beta.N`.
2. When the version changes, update it in `apps/cli/package.json` and its
   lockfile entry, commit the bump on a branch and merge it to `master`
   through a pull request. The private workspace packages keep `0.0.1`.
3. Optionally rehearse from `master`: `gh workflow run release.yml`. It runs
   everything but the GitHub release, with `npm publish --dry-run`.
4. Tag the merged commit with the version and push the tag:

   ```sh
   git tag v1.0.0-beta.2 origin/master
   git push origin v1.0.0-beta.2
   ```

   The workflow fails before building when the tag does not match
   `apps/cli/package.json`.
5. Watch the run (`gh run watch`), then verify `latest` points to the new
   version and the release exists:

   ```sh
   npm view @notaharness/n10 dist-tags --json
   gh release view v1.0.0-beta.2
   ```

If a job fails, inspect published versions before re-running; npm refuses to
republish an existing version. A failed `github-release` job can be re-run
alone after `publish` succeeded.

To try the package locally, `npx nx run cli:prepare-publish`, `npm pack` in
`apps/cli/dist`, then `apps/cli/scripts/test-installed.sh <tarball>`, the
check CI runs. `cli:install-global` installs it into your own global prefix.

Read [packaging notes](references/packaging.md) when changing publish preparation,
the release workflow, runtime dependencies, global installation, or
agent-review command availability.
