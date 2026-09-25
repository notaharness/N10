# Testing

Use Nx targets. Unit tests cover core behavior and view models; use
`ink-testing-library` for TUI text and keyboard handling. E2E exercises terminal
rendering, PTY forwarding, Electron IPC and complete user flows.

```sh
npx nx test <project>
npx nx e2e cli-e2e
npx nx e2e desktop-e2e
npx nx e2e:visual desktop-e2e
```

Confirm new tests fail when the relevant behavior is deliberately broken, then
restore it. Preserve property-test counterexamples as regression cases. Tab and
diff properties should check invariants such as valid active ids and comments
appearing exactly once.

## Desktop

The `desktop-e2e` targets build Electron before testing. Directly invoking
`run-e2e.mjs` or `run-visual.mjs` does not; run `npx nx build desktop` first.

`src/fixtures/desktop.ts` creates a repo and isolated HOME, seeds optional git
states, supplies a scriptable fake agent and fails on renderer exceptions.
Every test uses a private tmux socket inside its fixture HOME and kills only
that fixture's sessions at teardown. It drops `N10_VITE_URL` to ensure tests
use the built app.

`src/setup/fake-beam.ts` answers beam's control socket in the fixture HOME with
a scripted daemon: enrolment, peers and their events, alias, grant and
ceremonies a test walks with `nextPasskeyStep`, `stage`, `failCeremony` and
`finishCeremony`, their URLs shaped as beam writes them. It never dials or
runs a passkey step. A test without it gets the real `beam daemon` from
`@notaharness/beam`, started by the app in the fixture HOME, unenrolled, and
stopped when the app quits.

`@beam` tests (`src/beam-fleet.test.ts`) run the app against real beam
daemons: `beam testkit` serves beam's dev DERP and fake directory worker on
loopback, a daemon in the fixture HOME is the one the app finds, a second
daemon with its own HOME is another machine, and beam's test authenticator
answers every ceremony (`src/setup/beam-testkit.ts`). These need a `beamtest`
build, so a plain run leaves them out. `run-beam-e2e.mjs` downloads the
`beamtest-<os>-<arch>` asset of the beam release matching the installed
`@notaharness/beam`, checks it against the checksums pinned in the script
(replace them when bumping beam) and caches it under
`node_modules/.cache/beamtest`; `BEAM_TEST_BINARY`, an absolute path, names a
local build instead:

```sh
npx nx e2e:beam desktop-e2e
BEAM_TEST_BINARY=$HOME/beam/beamtest npx nx e2e:beam desktop-e2e
```

`src/setup/fake-gh.ts` supplies offline PRs, threads, comments and checks through
a fake executable on PATH. Set a PR's `headRefName` to a real fixture branch for
a real diff. Seeded worktree branches must be slash-free because the fixture and
app construct paths differently. Provider project fields belong in `vendorProject`
or auto-detection replaces them.

Tests run under Xvfb on Linux, even with DISPLAY set. The fixture drops
`WAYLAND_DISPLAY` and selects X11. Use `N10_E2E_HEADED=1` to watch a run.
`@visual` tests run in the pinned Playwright container with zero pixel tolerance.
From `apps/desktop-e2e`, run `node run-visual.mjs --update-snapshots` after building,
and inspect the resulting image diff.

`src/setup/menu.ts` controls native context and application menus. Menu
accelerators such as Ctrl+, are not renderer keybindings. Terminal fixtures seed
an empty `.zshrc` to avoid the first-run wizard; `liveTerminals` is a record to
avoid Playwright interpreting an array as a fixture tuple. The fake agent's
`--print-size` includes its pid so tests can distinguish restarted processes.

Desktop `@integration` tests read permanent PRs through the real provider.
Pass GH_TOKEN explicitly because the isolated HOME hides stored gh credentials:

```sh
GH_TOKEN=$(gh auth token) npx nx e2e:integration desktop-e2e
```

## TUI and browser bridge

`apps/cli-e2e/src/fixtures/n10.ts` creates a repo and HOME, sends `/spawn` to
`cli-wterm-host`, waits for n10 to render, and yields `{ term, repoPath, homeDir }`.
Teardown calls `/kill` and removes fixture directories. Configure it with
`test.use({ n10Config: { keybindPreset: 'vim' } })`.

`term` provides `getByText`, `press`, `type`, `write` and `resize`. Wait for DOM
updates between tight input/assertion loops, and for dialogs to close before
sending the next command. Necessary fixed waits use `settleFor(page, ms, reason)`;
prefer auto-waiting assertions. Use `src/setup/sidebar.ts` for icon locators.

The host serves one PTY; Playwright uses one worker. Concurrent suites cannot
share port 5174. `/spawn` replaces the PTY, `/kill` ends it, and `/pty` replays
buffered output after reconnect. A WebSocket disconnect does not end the PTY.
Strip CI variables from the spawned TUI's environment so Ink renders interactively.

Both suites' tmux helpers must assert that their socket directory belongs to a
fixture HOME and unset TMUX before any operation. All terminal tests require
tmux 3.2 or newer. Never kill the default server or use `kill-server`.
See `libs/terminal-tmux/AGENTS.md`.

Failures retain traces, screenshots and video in `test-output/`.
`error-context.md` is useful for text inspection. Open a trace with
`npx playwright show-trace <trace.zip>`. Keep Playwright `outputDir` aligned with
Nx target outputs so cached artifacts are valid. Each target owns a separate
subdirectory — `desktop-e2e` writes `test-output/playwright` for `e2e` and
`test-output/visual` for `e2e:visual` (`N10_E2E_OUTPUT_BASE`, set by
`run-visual.mjs`). Playwright empties the directory it is given at the start of
a run, so two targets sharing one lose the first one's results, including a
failing screenshot's expected/actual/diff PNGs.

## Interactive QA

Start `npx nx serve cli-wterm-host`. The repository's configured Playwright MCP
attaches to Chrome on CDP port 9222; it does not launch Chrome. Clients without
that MCP can use their available browser tools against `http://localhost:5174`.

VS Code's `n10 in Chrome (wterm)` launch configuration or `Launch Chrome for
n10 QA` task starts Chrome with the isolated `.vscode/chrome` profile. A shell
can start the same instance:

```sh
chromium --remote-debugging-port=9222 --user-data-dir=.vscode/chrome \
  --no-first-run --no-default-browser-check --hide-crash-restore-bubble \
  http://localhost:5174
```

Only one process can own that profile and port. Reuse it or close it before
starting another. Browser launch may require the agent environment's approval.

## README media

`apps/desktop-e2e/demo/capture.mjs` drives the built app under Xvfb with fake gh
and a paced demo agent, then records GIFs and stills into `docs/media/`.
The TUI capture uses the wterm bridge. `theme-slider.py` makes the light/dark
hero wipe. Raw captures are ignored under `docs/media/raw/`.
Read the demo directory's README before recording.

## Integration Tests

Integration tests exercise real GitHub operations and are **skipped** when `GH_TOKEN` is not set.

- `merge-auto-delete.test.ts` — creates branches, PRs, merges, verifies n10 auto-deletes the session
- `reviews-fixture.test.ts` — reads permanent fixture PRs in the test repo, verifies the Reviews tab categorizes them correctly

**Running locally:**

```sh
GH_TOKEN=<fine-grained-PAT> npx nx e2e:integration cli-e2e
```

**Required PAT permissions** (scoped to the test repo only):

- Contents: Read & Write (clone, push branches, delete branches)
- Pull requests: Read & Write (create, merge, close PRs)
- The PAT owner must have admin access on the test repo (for `--admin` merge)

**Environment variables:**

- `GH_TOKEN` — fine-grained PAT for the test repo (required to run integration tests)
- `TEST_REPO` — override the test repo (default: `kirby-test-runner/kirby-integration-test-repository`)
- `N10_LOG` — set automatically by the test to capture debug logs from the n10 process

**Fixture PRs in the test repo** (used by `reviews-fixture.test.ts`):

| PR   | Branch                      | Title                                  | CI     | Review (by kirby-test-runner)                                                          |
| ---- | --------------------------- | -------------------------------------- | ------ | -------------------------------------------------------------------------------------- |
| #37  | `fixture/add-color-support` | Add color support for tile values      | passes | Approved                                                                               |
| #38  | `fixture/add-undo-feature`  | Add undo feature with history stack    | passes | Changes requested (3 inline comments)                                                  |
| #39  | `fixture/add-ai-solver`     | Add AI solver for auto-play mode       | fails  | Approved (1 suggestion comment)                                                        |
| #322 | `fixture/outdated-thread`   | Outdated thread fixture (do not merge) | n/a    | 2 outdated inline comments (by HermannBjorgvin) + kirby-test-runner involvement marker |

These PRs are permanent fixtures — tests only read them, never modify. The test repo contains a C 2048 game project.

PR #322 is an exception in shape: it has two commits where the second
rewrites the function the review comment was anchored to, so GitHub
flags the thread `isOutdated: true` with `line: null` and only
`originalLine` set. Used by `outdated-thread.test.ts` to verify the
diff viewer renders outdated threads inline at their `originalLine`
instead of dropping them into the "comments on lines not in diff" tail.

The test account must be involved in #322 for GitHub's `involves:` sidebar
query to include it. A review-comment marker provides that involvement. If it
is missing, an authorized fixture-maintenance task can restore it with:

```bash
GH_TOKEN=<integration-pat> gh api \
  repos/kirby-test-runner/kirby-integration-test-repository/pulls/322/reviews \
  -f event=COMMENT \
  -f body="kirby-test-runner involvement marker — keeps PR #322 visible to the involves: sidebar query for the outdated-thread fixture test."
```

**CI pipelines:**

- **CI** (`.github/workflows/ci.yml`) — runs `nx affected -t lint test build typecheck e2e`. Runs `npx playwright install --with-deps chromium` before `nx affected` (needed for `cli-e2e`). Uploads `apps/cli-e2e/test-output/` as an artifact on failure. Integration tests skipped (no `GH_TOKEN`).
- **Integration Tests** (`.github/workflows/integration.yml`) — runs `npx nx e2e:integration cli-e2e` with `GH_TOKEN` from the `INTEGRATION_TEST_PAT` secret. Triggers on PRs, pushes to master, and manual dispatch. Uses `concurrency` with `cancel-in-progress: false` because the test repo is shared state.
- **Package** (`.github/workflows/package.yml`) — packs `@notaharness/n10` and runs `apps/cli/scripts/test-installed.sh` on the tarball in a clean container. Triggers on PRs touching packaging; the Release workflow calls it before publishing.
- **Release** (`.github/workflows/release.yml`) — publishes on a `v*` tag; see the `publish-beta` skill.

## Orchestra interoperability

`npx nx test core` includes `orchestra.integration.spec.ts`, which installs the
pinned Orchestra package under a fixture HOME and runs its real Bash scripts
against an isolated tmux server. Only the agent CLI and report queue are fake.
The suite covers large prompts, tagged discovery, n10 attaching without
restarting a player, Orchestra adopting and stopping n10 players, and successful
and failed report delivery. It does not exercise a model or CLI plugin manager.

The archive, provenance, checksum and update instructions live in
`libs/core/tests/fixtures/README.md`. Tests require no network or agent login;
tmux is installed in CI, and the live suites skip locally when it is absent.
`terminal-allocation.integration.spec.ts` exercises names becoming occupied or
free between a tab's preliminary name probe and the backend's allocation.
