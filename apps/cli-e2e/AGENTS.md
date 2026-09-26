# apps/cli-e2e — TUI end-to-end tests

Playwright drives n10 in headless Chromium through `apps/cli-wterm-host`.
The fixture (`src/fixtures/n10.ts`) gives each test a temp Git repo, an
isolated HOME with an optional `.n10/config.json` (`test.use({ n10Config })`),
`POST`s `/spawn`, waits for `n10` to paint, and yields
`{ term, repoPath, homeDir }`. `term` exposes `getByText`, `press`, `type`,
`write` and `resize`. Full infrastructure notes: `docs/testing.md`.

- Every test uses tmux on a private socket inside its scratch HOME. The
  fixture waits for the host PTY to exit, then reaps individual sessions
  before deleting HOME, including after startup failures. A failed host
  shutdown preserves HOME rather than deleting files a process may still use. Both `TMUX` and `TMUX_PANE` are unset.
- Tag live-GitHub suites `@integration`; offline runs exclude them. They need
  `GH_TOKEN`. Fixture-reading tests leave permanent PRs unchanged, but
  `merge-auto-delete.test.ts` creates branches and PRs and merges them in the
  test repository. See `docs/testing.md` for credentials and fixture details.
- Fixed waits go through `src/setup/waits.ts` `settleFor(page, ms, reason)`;
  `playwright/no-wait-for-timeout` is off for that file alone. Reach for an
  auto-waiting assertion first.
- `page.keyboard.press` returns before wterm's DOM updates: pace tight
  press-then-check loops with `locator.waitFor`, and wait for the branch
  picker to close before the next `c` in sequential creates.
- Sidebar icon assertions: `src/setup/sidebar.ts` `sidebarLocator`.
- `src/setup/tmux.ts` proves its socket dir is a fixture temp home before it
  lists or kills anything.
- Failures keep trace, screenshot and video under `test-output/`; open with
  `npx playwright show-trace <trace.zip>`. `error-context.md` is more greppable
  than the PNG. `outputDir` and the nx target's `outputs` must agree or nx
  caches stale artifacts.
- Interactive QA: `npx nx serve cli-wterm-host`, then one Chrome on CDP port
  9222 with the `.vscode/chrome` profile (VS Code F5 or the command in
  `docs/testing.md`); the repository-configured Playwright MCP attaches to it.
- The browser terminal renders cells only: no kitty graphics, no mouse
  reports. Assert escape _bytes_ through the host's `GET /output` (base64 ring
  buffer) and inject SGR wheel/click sequences with `term.write()`. Real-pixel
  checks are manual QA in kitty or ghostty.
- `playwright.config.ts` and the fixture key off `PORT` (default 5174) with
  `reuseExistingServer`; set `PORT=<n>` when another checkout may be running
  e2e, or you drive its stale build.
