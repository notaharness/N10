# Senior Ink Reviewer Memory

## Project Structure

- `apps/cli/` -- Ink v6 TUI app (React 19, ESM-only), entry at `src/main.ts`, TUI at `src/tui.tsx`
  - `src/components/` -- Shared components (SidebarLayout, TerminalView, TabBar, etc.)
  - `src/screens/sessions/` -- Sessions tab (SessionsTab, Sidebar, BranchPicker, sessions-input)
  - `src/screens/reviews/` -- Reviews tab (ReviewsTab, ReviewsSidebar, ReviewPane, reviews-input)
  - `src/context/` -- React contexts (AppState, Session, Review, Config)
  - `src/hooks/` -- Custom hooks (useTerminal, useDiffData)
- `libs/worktree-manager/` -- Git worktree and branch operations
- `libs/terminal/` -- PTY session + terminal emulation (node-pty + @xterm/headless)
- `libs/vcs-core/` -- VCS provider abstraction (config, PR types)
- `libs/vcs-github/`, `libs/vcs-azure-devops/` -- VCS provider implementations
- Serve target uses `nx:run-commands` with tsx for ESM compat (not @nx/js:node)

## Key Architectural Issues (2026-03-07 full review, updated after refactor)

- **State split into contexts**: AppStateContext, SessionContext, ReviewContext, ConfigContext (previously a single god object)
- **Input handlers split by feature**: `screens/sessions/sessions-input.ts` and `screens/reviews/reviews-input.ts` with shared helpers in `input-handlers.ts`
- **tui.tsx slimmed down**: ~136 lines, delegates to SessionsTab and ReviewsTab screen components
- **pty-registry.ts**: module-level mutable Map singleton, no React integration
- **No error boundaries** -- unhandled error crashes entire TUI
- **Test files** for cli app: `pr-utils.spec.ts`, `session-sort.spec.ts`
- **No resize listener** -- `useStdout().stdout.rows/columns` doesn't update on resize

## Ink Patterns

- Two `useTerminal` instances (sessions + reviews) with independent PTY connections
- `useRawStdinForward`: raw stdin -> PTY with mouse event handling, Ctrl+Space escape
- `usePtySession`: 16ms debounced render via setTimeout, ref-based callback pattern
- Four React contexts: ConfigContext, AppStateContext, SessionContext, ReviewContext
- Components use `memo()` appropriately: TerminalView, BranchPicker, ReviewPane, TabBar
- overflow="hidden" + wrap="truncate" on TerminalView for content clipping

## Layout arithmetic lives in several places — check before adding a copy

- `@n10/core` `utils/diff-scroll.ts` owns `diffViewportHeight(paneRows)` =
  `max(1, paneRows - 3)` and says in its docblock that keeping the constant in
  one place is the point. Three hand-rolled copies exist anyway
  (`screens/main/diff-viewer-input.ts`, `screens/main/DiffFileViewerContainer.tsx`,
  `screens/reviews/diff-viewer-viewport.ts`). Any new viewport code should call
  the core helper.
- Two unrelated `sidebar-model.ts` + `.spec.ts` pairs now exist:
  `apps/cli/src/components/` (TUI row heights + scroll window) and
  `apps/desktop/src/renderer/lib/` (PR status indicator, pending removals).
  Always path-qualify when referring to either.

## Recurring Issues

- Shell injection risk in git functions using string interpolation
- Stale closures in event handlers -- use functional setState form
- Stale closure risk in `findSortedIndex` useCallback (closes over sessionPrMap): works by accident because PR data doesn't refresh in same async flow as session creation. Document or pass explicitly.
- Duplicated logic (branch filtering computed in both input handler and BranchPicker)
- No useWindowSize() for terminal resize

## Review History

- 2026-02-25: Reviewed perf async conversion + serve target cleanup
- 2026-02-26: Reviewed xterm-headless removal, self-managed worktrees feature
- 2026-03-07: Full codebase review of apps/cli/src/ -- see detailed findings in review output
- 2026-03-17: Session sort bug fix review -- sorted index extracted to `utils/session-sort.ts`, stale closure concern flagged
- 2026-08-29: Reviewed the 8-commit max-lines split. CLI half is behaviour-preserving
  (verified `OrphanPrRow`+`ReviewPrRow` -> `PrItemRow` lossless; scroll/viewport
  arithmetic character-faithful). Gaps: `sidebarAvailableLines` untested,
  `PlanAnnotateInput` duplicated in `DiffListCommentItem`, a 4th copy of
  `paneRows - 3`. See [reviewing_technique.md](reviewing_technique.md).
- 2026-04-13: Modal + Toast system review -- Toast has setTimeout leak + cap-evict timer leak; flagged Ink 6.8 inset props are dead code (not implemented in runtime). See [ink_6_8_inset_props.md](ink_6_8_inset_props.md).
