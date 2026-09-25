# apps/cli — the `n10` command and the Ink TUI

This project is the published `@notaharness/n10` package. `src/main.ts` is the
`n10` executable: plain `n10` runs Electron on the desktop build shipped beside
it (`commands/launch-desktop.ts`), `--tui` loads `src/tui.tsx`, and `util`
loads `commands/util.ts`, which is `@n10/review-comments` alone. Those two are
dynamic imports of local modules (Nx forbids lazy-loading a library imported
statically elsewhere), which esbuild splits into chunks. Keep Ink, React and
Electron out of `main.ts`'s static imports so `util`, `--help` and `--version`
stay fast.

The TUI is a thin render layer over `@n10/app-core`. `src/input-handlers.ts`
holds the keybind-driven state transitions; screens under `src/screens/main`
(sidebar, diff, branch picker) and `src/screens/reviews`; pure view-models in
`src/models`; Ink-coupled hooks in `src/hooks`. Reasoning for the rules below:
`docs/decisions.md`.

- Before changing Ink components or input handling, read the shared
  `building-ink-cli-apps` skill.
- Full-screen layout: `useStdout()` for rows/columns, `height={rows}` on the
  root `<Box>`. The PTY is sized to the terminal minus chrome (sidebar width,
  borders, status bar).
- Output path: `TerminalEmulator` (@xterm/headless) renders ANSI that `<Text>`
  passes straight through. Input path: raw stdin → PTY write
  (`hooks/useRawStdinForward.ts`); the Ctrl+Space (`\x00`) escape to the
  sidebar is hardcoded there, outside `keybindings/registry.ts`.
- Ink lint rules (`tools/eslint-plugin-ink.mjs`): `no-raw-text`,
  `no-layout-inside-text`, `no-bare-process-exit` (off for the entry points
  `main.ts` and `tui.tsx`, which own exiting). Ink throws at runtime for these, so a
  violation type-checks and dies when the branch first renders.
- The serve target sets `TSX_TSCONFIG_PATH` so tsx uses `jsx: react-jsx`;
  without it every file needs `import React`.
- Ink paints nothing when `CI`, `CONTINUOUS_INTEGRATION` or `GITHUB_ACTIONS`
  is set. Strip them from any env that spawns n10.
- Worktree removal uses core's shared stop → remove → delete sequence.
  `stopSession` terminates one held target or one persisted target, never both.
- `usePrData` polls the provider itself; it is the only reader in this process.
  The desktop reads a shared cache instead.
- Rows are named by branch here; the desktop names a PR row by its title.
- Tests: `ink-testing-library` for text content and keyboard navigation. ANSI
  rendering, PTY forwarding and real terminal interaction are manual or
  `apps/cli-e2e`. Specs are type-checked through `tsconfig.spec.json`; a new
  project must reference its spec tsconfig as well as the app one.
- `n10 util add-comment` (`@n10/review-comments` `util-command.ts`) is how a
  review agent records drafts; desktop sessions run it through the desktop's
  own shim (decisions.md D16). Draft posting is one comment
  per `postReviewComments` call so a mid-batch failure cannot reset live
  comments to draft.
- Packaging: `prepare-publish` assembles `dist/` from this build and the
  desktop build; see the `publish-beta` skill.
- Comment images (`![alt](url)`) render inline through kitty graphics only
  when `TERM` is kitty/ghostty or `N10_IMAGES=kitty`; other terminals keep the
  markdown token; `N10_IMAGES=off` disables. `useCommentImages` owns the
  pipeline and `CommentImagesContext` carries per-url state and `layouts`;
  every row estimator (`estimateBodyRows`, `estimateCardRows`, `buildRowMap`,
  `planCommentFooter`) takes `imageLayouts` so scroll geometry matches painted
  height. `@cwasm/webp` reads `webp.wasm` from disk; `scripts/prepare-publish.mjs`
  places it beside the bundle.
- Mouse: `useScrollWheel` / `useMouseClicks` enable SGR tracking, parse every
  report in a stdin chunk, route by pointer column (sidebar cols ≤ 48), and
  refcount the enable/disable writes. With tracking on the terminal no longer
  opens OSC-8 links, so the sidebar opens a clicked PR badge itself
  (`utils/open-url.ts`), and `handleTextInput` drops SGR reports Ink surfaces as
  printable input.
