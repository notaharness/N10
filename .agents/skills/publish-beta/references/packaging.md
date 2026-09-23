# Packaging

Both packages share one version, enforced by `scripts/shared-version.mjs`.
Publish preparation must leave no private `@n10/*` workspace dependencies in
the distribution manifests. Each one copies its own `README.md` into its
`dist`, because npm reads it from the pack root: without it the npm page is
blank.

## CLI

`npx nx build cli` produces `apps/cli/dist/main.js` with a Node shebang and
bundles workspace libraries and JavaScript dependencies. `node-pty` stays external.
`prepare-publish.mjs` rewrites the copied package manifest for npm publication.

## Desktop

`prepare-install.mjs` writes the distribution manifest, copies the executable
launcher, README and LICENSE, and packs the tarball used by `install-global`.
Set `publishConfig.access: public` for the scoped package. Runtime dependencies
are Electron and node-pty. Linux installs need the native build tools documented
in the desktop README; verify supported platforms when upgrading dependencies.

## Review-agent command

Review agents record drafts with `n10 util add-comment`, supplied by the CLI.
Desktop users need both packages for that workflow. A dependency's executable is
not exposed on the user's global PATH, and declaring the same executable in two
global packages causes install conflicts. Keep this requirement in both READMEs
until command delivery changes.

## Tags

Publish with `beta`, then move `latest` to the same version using
`scripts/dist-tag-latest.mjs`. This keeps installs with and without `@beta`
consistent. Verify both tags for both packages after releasing.
