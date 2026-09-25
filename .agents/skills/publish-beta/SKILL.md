---
name: publish-beta
description: Publish the n10 npm package at a new beta version. Use only when the user requests a release.
disable-model-invocation: true
---

# Publish a beta

Publish only when the user asks. n10 is one package, `@notaharness/n10`
(`apps/cli`), which carries the desktop app too.

1. Check the worktree and the current version in `apps/cli/package.json`
   against `npm view @notaharness/n10 versions --json`. If that version is
   unpublished, release it as is; otherwise choose the next `-beta.N`.
2. Verify `npm whoami` identifies an account with access to the scope.
3. When the version changes, update it in `apps/cli/package.json` and its
   lockfile entry. Review the diff, run the relevant checks, and commit the
   version bump. The private workspace packages keep `0.0.1`.
4. Run the Nx target, which builds the CLI and the desktop, prepares the
   publishable `dist`, publishes with `--tag beta`, then moves `latest` via
   `apps/cli/scripts/dist-tag-latest.mjs`:

   ```sh
   npx nx run cli:publish
   ```

5. Verify the `beta` and `latest` tags point to the chosen version:

   ```sh
   npm view @notaharness/n10 dist-tags --json
   ```

If a step fails, inspect published versions and tags before retrying; do not
republish an existing version.

To try the package before publishing, `npx nx run cli:prepare-publish`, then
`npm pack` in `apps/cli/dist` and install the tarball into a scratch prefix
(`npm install -g --prefix <dir> <tarball>`). `cli:install-global` installs it
into your own global prefix.

Read [packaging notes](references/packaging.md) when changing publish preparation,
runtime dependencies, global installation, or agent-review command availability.
