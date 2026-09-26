Refs #32, to be closed by hand once the first release has published through OIDC and `NPM_TOKEN` is deleted. The beam parts of notaharness/n10#141 and notaharness/n10#134 (Launch, notaharness/n10#133).

## npm trusted publishing

`.github/workflows/release.yml`, job `publish`: publishes the four platform packages and then the shim with no npm token. npm (11.5.1 or later, from Node 24) authenticates each package through its trusted publisher with the job's OIDC token (`id-token: write`), and publishes with `--provenance`. Prereleases still go under the `next` dist-tag. Before it publishes anything, a dry run of each package checks that npm's OIDC exchange succeeded; npm runs the exchange even with `--dry-run` and logs the result at verbose level. So a missing or mistyped trusted publisher stops the job before any package is published and the version is spent. The publish step runs only on a tag, and a `workflow_dispatch` rehearsal runs the check in its place. setup-node no longer writes an `.npmrc` (`registry-url` is gone), since there is no token to put in it.

The spec and the release guide follow the workflow: `docs/09-build-and-distribution.md` (CI) describes trusted publishing as the only path, and `CONTRIBUTING.md` "npm trusted publishing" lists each package's trusted publisher settings and explains how to add a new package: publish it by hand at `0.0.0`, then set its trusted publisher.

## SECURITY.md

- Supported versions: the newest release, prerelease or not, gets fixes, shipped as a new release.
- Reporting: GitHub private vulnerability reporting, with what to include.
- What to expect: acknowledgement within 7 days, assessment, then a fix, an advisory, credit, and an agreed disclosure date.
- Scope: in scope are membership changes without a passkey approval, admission and grant bypasses, reading or forging directory entries and ceremony results, local exposure of keys, the mailbox and the control socket, the ceremony page, and the release artifacts. Out of scope are the threat model's "not defended against" cases from `docs/01-model.md`.

`CONTRIBUTING.md` links to it.

## README

`README.md` covers, in order: what beam is, installing it (npm, plus the passkey's PRF and X25519 requirements), and using it: create a fleet, add a machine, remove a machine, limit a machine with grants, `exec`/`connect`, and `msg`. After that come a short "How it works", the document index and the licence. Every command matches `beam --help` / `docs/07-cli.md` and parses in the CLI.

## Needs Hermann

1. **Trusted publishers.** On npmjs.com, for each of `@notaharness/beam`, `@notaharness/beam-darwin-arm64`, `@notaharness/beam-darwin-x64`, `@notaharness/beam-linux-x64` and `@notaharness/beam-linux-arm64`: Settings → Trusted Publisher → GitHub Actions, with Organization `notaharness`, Repository `beam`, Workflow filename `release.yml`, Environment empty. Then Settings → Publishing access → "Require two-factor authentication and disallow tokens".
2. **Delete the token.** Revoke the npm access token behind `NPM_TOKEN` on npmjs.com, then `gh secret delete NPM_TOKEN -R notaharness/beam`. Every release so far (up to `0.1.0-beta.3`) published with the token, so the first tag after this merges is the first OIDC publish. Run the rehearsal first (`gh workflow run release.yml -f version=vX.Y.Z`): it fails if any package's trusted publisher does not accept the workflow.
3. **Private vulnerability reporting is off** (`{"enabled":false}`). Turn it on under Settings → Code security → Private vulnerability reporting, or `gh api -X PUT repos/notaharness/beam/private-vulnerability-reporting`. Until then the link in SECURITY.md goes nowhere.
4. **`latest` during the beta.** Prereleases go to `next`, so `latest` (what `npm install -g @notaharness/beam` installs) stays on `0.1.0-beta.3` until a stable release. Either move it by hand with each beta (`npm dist-tag add @notaharness/beam@X.Y.Z latest`, and the same for each platform package), or leave it.
5. **Confirm the 7-day acknowledgement** promised in SECURITY.md, or change it.
6. **Run the README flow with a real passkey.** `init`, `join` and `revoke` were checked against the CLI and the spec. They were not run end to end, because each needs a passkey ceremony.
