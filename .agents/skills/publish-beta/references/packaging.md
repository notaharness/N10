# Packaging

`@notaharness/n10` is assembled in `apps/cli/dist` by the `cli:prepare-publish`
target, which depends on `cli:build` and `desktop:build`. Publish preparation
must leave no private `@n10/*` workspace dependencies in the manifest. It
copies `apps/cli/README.md` into `dist`, because npm reads it from the pack
root: without it the npm page is blank.

## Layout

- `main.js`, the `n10` bin, and its esbuild chunks. `npx nx build cli` splits
  the `--tui` and `util` paths into chunks loaded on demand, and bundles
  workspace libraries and JavaScript dependencies. `node-pty` stays external.
  `webp.wasm` sits beside the chunks because `@cwasm/webp` reads it from disk.
- `desktop/{main,preload,renderer}`, the desktop build unchanged.
- `package.json`, written by `prepare-publish.mjs`. Its `main` is
  `desktop/main/main.js`, so plain `n10` runs Electron on the package
  directory itself; `productName` names the app and its userData directory.
  `files` is explicit, because without it npm pack honors the repo's
  `.gitignore`. `publishConfig.access: public` publishes the scoped package.

## Runtime dependencies

Electron, node-pty and `@notaharness/beam`, whose platform package holds the
`beam` binary the desktop runs as its daemon. The manifest takes Electron's and
beam's versions from `apps/desktop/package.json` and node-pty's from
`apps/cli/package.json`. node-pty is N-API based, so one build loads in Node
and Electron. Linux installs compile it and need the native build tools
documented in the README; verify supported platforms when upgrading
dependencies. TUI-only users download Electron too; that is accepted.

## Review-agent command

Review agents record drafts with `n10 util add-comment`, which the package
supplies globally. Desktop sessions reach it through a shim in the desktop
bundle (decisions.md D16), so drafting works where no `n10` is on a session's
PATH and matches the running app's version.

## Install test

`apps/cli/scripts/test-installed.sh` installs a packed tarball into a scratch
global prefix and runs the CLI, the TUI and the desktop under Xvfb.
`.github/workflows/package.yml` runs it in a clean `node` container (pinned
Node version; see its comment) on pull requests that touch packaging, and as
the release gate.

## Release workflow

`.github/workflows/release.yml` runs on a `v*` tag, which must equal
`apps/cli/package.json`'s version. The `publish` job publishes the tarball the
Package workflow tested, through npm trusted publishing (OIDC) with
provenance. The trusted publisher on npmjs.com names this repository, `release.yml`
and the `npm` environment, whose deployment rule admits only `v*` tags;
renaming the workflow file or the environment breaks publishing until it is
updated there. A dispatched rehearsal runs `npm publish --dry-run` in its own
job, outside that environment.

Trusted publishing authenticates `npm publish` only, not `npm dist-tag`, so a
release sets one tag: `latest`. Every release, prerelease or not, is what a
plain `npm install -g @notaharness/n10` installs.

The `github-release` job creates the GitHub release with generated notes and
attaches every artifact named `release-*` from the run. Jobs that build
release assets upload under that prefix and join its `needs`.
