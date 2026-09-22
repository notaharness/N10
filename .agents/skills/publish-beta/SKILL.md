---
name: publish-beta
description: Publish all three n10 npm packages at the same beta version. Use only when the user requests a release.
disable-model-invocation: true
---

# Publish a beta

Publish only when the user asks. All three packages release together:
`@notaharness/n10` (`apps/cli`), `@notaharness/n10-desktop` (`apps/desktop`)
and `@notaharness/beam` (`apps/beam`).

1. Check the worktree and current versions. Choose one shared `-beta.N` version;
   every publish-prep script enforces equality through `scripts/shared-version.mjs`.
2. Verify `npm whoami` identifies an account with access to the scope.
3. Update all three package versions and any corresponding lockfile entries.
   Review the diff, run the relevant checks, and commit the version bump.
4. Run the Nx targets in sequence, stopping on failure:

   ```sh
   npx nx run cli:publish && npx nx run desktop:publish && npx nx run beam-cli:publish
   ```

5. Verify each package's `beta` and `latest` tags point to the chosen version:

   ```sh
   npm view @notaharness/n10 dist-tags --json
   npm view @notaharness/n10-desktop dist-tags --json
   npm view @notaharness/beam dist-tags --json
   ```

Each target builds, prepares its publishable `dist` package, publishes with
`--tag beta`, then moves `latest` via `scripts/dist-tag-latest.mjs`. If a step
fails, inspect published versions and tags before retrying; do not republish
an existing version or bump only some of the packages.

Read [packaging notes](references/packaging.md) when changing publish preparation,
runtime dependencies, global installation, or agent-review command availability.
