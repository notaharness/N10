<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

# General Guidelines for working with Nx

- For navigating/exploring the workspace, invoke the `nx-workspace` skill first - it has patterns for querying projects, targets, and dependencies
- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- Prefix nx commands with the workspace's package manager (e.g., `pnpm nx build`, `npm exec nx test`) - avoids using globally installed CLI
- You have access to the Nx MCP server and its tools, use them to help the user
- For Nx plugin best practices, check `node_modules/@nx/<plugin>/PLUGIN.md`. Not all plugins have this file - proceed without it if unavailable.
- NEVER guess CLI flags - always check nx_docs or `--help` first when unsure

## Scaffolding & Generators

- For scaffolding tasks (creating apps, libs, project structure, setup), ALWAYS invoke the `nx-generate` skill FIRST before exploring or calling MCP tools

## When to use nx_docs

- USE for: advanced config options, unfamiliar flags, migration guides, plugin configuration, edge cases
- DON'T USE for: basic generator syntax (`nx g @nx/react:app`), standard commands, things you already know
- The `nx-generate` skill handles generator discovery internally - don't call nx_docs just to look up generator syntax

<!-- nx configuration end-->

# n10

n10 was formerly named Kirby; the repository is `notaharness/n10`.

n10 runs coding agents in git worktrees and reviews their pull requests.
Nx monorepo with npm workspaces and ESM: `apps/cli` is the Ink TUI,
`apps/desktop` is Electron, `apps/website` is the Next.js/Fumadocs site at
n10.is, `libs/core` owns shared operations, and `libs/app-core` supplies
React hooks and controllers.

## Context and tools

- Before editing, read each `AGENTS.md` between the repository root and the
  target file. A session started at the root may not load nested files automatically.
- Shared skills live in `.agents/skills/`. Read the relevant `SKILL.md` directly
  if your agent does not expose it. Claude and Copilot use symlinks to these files.
- Use Nx MCP when available; otherwise use `npx nx` and installed plugin docs.
  Claude plugins and hooks are not prerequisites for other agents.
- Read reference docs only for the task at hand. Paths below are repository-relative.
  See `docs/agent-context.md` for loading behavior and maintenance.

## Commands

```sh
npx nx test <project>                 # unit tests
npx nx run-many -t lint --all         # warnings fail too
npx nx run-many -t typecheck --all
npx nx serve cli                      # rebuild dependencies and run the TUI
npx nx e2e cli-e2e                    # offline TUI tests
npx nx e2e desktop-e2e                # offline Electron tests
npx nx e2e:visual desktop-e2e          # screenshots in a pinned container
GH_TOKEN=$(gh auth token) npx nx e2e:integration desktop-e2e
npx nx dev website                    # apps/website at http://localhost:3100
```

See `apps/website/README.md` for that project's own commands and
conventions (it doesn't follow the workspace's tsconfig or import style —
Next.js requires otherwise).

- Install dependencies with `npm ci` in a fresh worktree before running code
  checks. Do not copy another checkout's `node_modules`; workspace links and
  nested dependencies must belong to this checkout. Typecheck before code edits.
- Run checks appropriate to the change. Full lint uses `--all` to include
  projects with their own ESLint configs. Claude's edit hook does not run in Codex.
- Pre-commit runs lint-staged. Use `lint && git commit` so lint failure stops
  the commit. Do not bypass hooks except for an explicitly requested throwaway WIP.

## Boundaries

- Put shared sequences of git, filesystem, PTY, config and provider operations
  in `@n10/core`; both shells call them. When changing worktree removal,
  consolidate the duplicated TUI and desktop flows there.
- Core cannot import React, Ink, Electron or `@n10/app-core`. The desktop
  renderer uses the browser-safe `@n10/core/plan`, never core's Node entry.
  Keep the core and app-core barrels separate.
- Terminal backends implement `SessionBackend` without n10-specific names.
  tmux session names are labels; `libs/core/src/lib/session-identity.ts`
  owns the `@orchestra-*` tags that identify a session and the label rules.

## Working conventions

- Make small, verifiable changes. For UI work, prove rendering and interaction
  before adding supporting infrastructure; use mocks for behavior you cannot observe.
- Continue through the requested scope. Report milestones and exact manual QA
  commands; pause when user feedback is needed to decide the next step.
- Write concise updates: what changed, why, checks run, and remaining limitations.
  Keep only durable constraints and useful failure modes. Omit session progress,
  dated counts, incidental history and speculative follow-up ideas.
- Commit generator or dependency changes before manual implementation edits.
- When adding a test, temporarily break the relevant behavior and confirm the
  test fails, then restore it. Preserve property-test counterexamples as regression cases.
- Lint budgets: 300 lines, complexity 12, nesting depth 4. Refactor before
  exempting. Suppressions need a `--` rationale; plugin-rule exceptions belong
  in the owning ESLint config. Details: `docs/linting.md`.
- Handle rejected promises. `asyncOps.run` reports through
  `setOperationErrorHandler` and must not reject; `void` is not error handling.
- Keep `react-hooks/todo` enabled outside the named exceptions in
  `eslint.config.mjs`; compiler analysis can skip functions it cannot lower.

## tmux safety

Tests and scripts must use a scratch socket directory inside a fixture-created
HOME and unset `TMUX`, which overrides `TMUX_TMPDIR`. Never run
`tmux kill-server`. Closing n10 detaches sessions; it must not kill them.
See `libs/terminal-tmux/AGENTS.md`.

## Git and releases

- Branch from `master`. Use Conventional Commits with project scopes:
  `fix(desktop):`, `feat(core):`, `test(desktop-e2e):`.
- Use `gh` for GitHub and the `review-pr` skill for reviews. Post a review
  only when requested; a local review does not require publishing comments.
- Use `publish-beta` when asked to release.

## Reference

- `docs/architecture.md`: directory map.
- `docs/testing.md`: fixtures, visual QA and live integration tests.
- `docs/linting.md`: lint configuration and exceptions.
- `docs/decisions.md`: design rationale and known limitations.
