# Project structure

```
apps/cli/                        — The published `n10` package: the command, the Ink TUI (ESM, React 19) — thin render layer over @n10/app-core
  src/main.ts                    — `n10` entry: routes to the desktop, `--tui` or `util`, loading only that path
  src/commands/                  — Argument parsing and the Electron launch behind plain `n10`
  src/tui.tsx                    — TUI entry (`runTui`), root component
  src/input-handlers.ts          — Settings/controls input handlers (keybind-driven state transitions)
  src/components/                — Shared components (SidebarLayout, TerminalView, TabBar, StatusBar, etc.)
  src/models/                    — Pure view-models behind those components (sidebar-layout, comment-card-model, pr-badge-model)
  src/screens/main/              — Main tab (sidebar, diff, branch picker, confirm dialogs)
  src/screens/reviews/           — Reviews tab (DiffFileList, DiffViewer, ReviewDetailPane)
  src/hooks/                     — Ink-coupled hooks (useTerminal, useScrollWheel, useRawStdinForward, useDiffListScrollSync)
  scripts/prepare-publish.mjs    — Assembles dist/ into the package: the CLI bundle, the desktop build under desktop/, the manifest
apps/desktop/                    — Electron GUI shell over @n10/app-core, shipped inside `@notaharness/n10`
  src/main/tmux-session-preparer.ts — Utility-process boundary for isolated tmux server creation
  src/main/                      — Electron main: window chrome + security posture (window.ts), N10_QA_STEPS hook
  src/main/beam/                 — Client of the beam daemon's control socket: machines, remote exec/pty, ceremonies, mail relay, and the daemon the app starts
  src/preload/preload.ts         — Typed contextBridge → window.n10
  src/host/menu-template.ts      — Pure native app menu template, used by main and the web demo
  src/host/contract.ts           — Single source of truth for the bridge API + IPC channel names (incl. MenuCommand, ContextMenuItem, DesktopPrefs)
  src/host/services/             — Main-process services (sidebar w/ remote PR cache, sessions w/ scrollback buffer, settings, desktop-prefs…)
  src/renderer/                  — Vite + React 19 + Tailwind v4 web app (no Node access)
    styles.css                   — Design tokens (VS Code-style light/dark palette, type scale) — components use tokens only
    components/ui/               — shadcn-style primitives (radix-ui + cva + lucide): button, dialog, command, select…
    components/                  — TitleBar, StatusBar, CommandPalette, sidebar/, editor/ (tabs), settings/, terminal/
    components/review/           — the review workspace shell: PrWorkspace, PrHeader, ReviewRail(+Sections), ContentPane, OverviewPane, PlanPane/PlanControls
    components/review/comments/  — reviewer threads: ThreadCard, CommentsList, CommentMarkdown, ConversationPanel…
    components/review/diff/      — the viewer: DiffPane, VirtualDiffList, diff-rows, FileTree, SnippetView…
    components/review/drafts/    — the agent's drafts + walkthrough: DraftCard, DraftEditor, ReviewStepper…
    lib/                         — grouped by subsystem, not one flat folder (see below)
    lib/data/                    — queries.ts (TanStack Query over window.n10), mutations.ts, query-keys.ts
    lib/diff/                    — diff-model.ts (fold, split pairing), diff-virtual.ts, word-diff.ts, highlight.ts, thread-model.ts
    lib/tabs/                    — tabs-model.ts (pure reducer: preview/pinned, `sync-items`), tabs.tsx, use-close-tabs.tsx
    lib/plan/                    — plan-model.ts (rows, numbering), plan.ts, use-plan-checkout.ts
    lib/review/                  — review-model.ts (what the workspace shows), review-verdict.ts, severity.ts, use-comment-navigator.ts
    lib/sidebar/                 — sidebar-model.ts, sidebar-row-menu.ts, attention.ts
    lib/*.ts                     — what belongs to no subsystem: utils, theme, terminal-grid, content-key, settings-*
    screens/                     — RepoOpen (repo picker) and Workspace (shell + shortcuts)
  scripts/dev.mjs                — Dev orchestrator: esbuild watch + vite HMR + electron restart
  scripts/qa-shots.mjs           — Headless visual QA: drives the built app under xvfb and writes PNGs
apps/cli-wterm-host/             — HTTP + WS host that bridges n10 PTY to browser
  src/main.ts                    — Server: /spawn, /kill, WS /pty, ring buffer
  src/protocol.ts                — Shared SpawnRequest + ControlMessage types
  src/public/index.html
  src/public/client.ts           — Browser: @wterm/dom + auto-reconnect WS
  build.mjs                      — Single esbuild script (Node server + browser client)
apps/cli-e2e/                    — E2E tests (@playwright/test)
  src/fixtures/n10.ts          — Per-test: temp repo, POST /spawn, page, term helpers
  src/setup/                     — git-repo.ts, sidebar.ts, constants.ts, github.ts
  src/*.test.ts                  — Test files (one per feature area)
  playwright.config.ts           — chromium-only, workers: 1, webServer: nx serve cli-wterm-host
apps/website/                    — Next.js 16 + Fumadocs site at n10.is, deployed to Cloudflare via OpenNext
  content/docs/                  — MDX docs content, compiled by fumadocs-mdx into the generated .source/
  src/app/(home)/                — Landing page (HomeLayout)
  src/app/docs/                  — Docs layout + catch-all page (DocsLayout, source loader)
  src/app/llms.txt, llms-full.txt — Agent-facing page index and full content (see src/lib/llms.ts)
  src/components/landing/        — Marketing page sections, data-driven where repeated (Features)
  Own tsconfig/eslint/import conventions — see apps/website/README.md, not this file
libs/core/                       — Shell-agnostic core. No React, Ink or Electron (lint-enforced)
  src/lib/session/               — Session launch + plan checkout flows
  src/lib/plan/                  — Plan store (external store) + prompt composition
  src/plan.ts                    — Browser-safe entry (`@n10/core/plan`) for the renderer
  src/lib/utils/                 — Pure helpers (sidebar-items, session-sort, diff-fetcher, virtual-viewport…)
  src/lib/settings/              — Settings field model (fields, presets, resolveValue)
  src/lib/sync/                  — Remote sync passes (sweepMergedBranches, conflict counts)
  src/lib/agents/                — Agent registry
  src/lib/activity.ts            — Agent activity registry; pty-registry.ts — PTY session lifecycle
  src/lib/session-backend.ts     — Required tmux availability, tagged-session observations and cleanup
  src/lib/session-identity.ts    — `@orchestra-*` tag names, session labels and matching rules shared with Orchestra
  src/lib/session-resolver.ts    — The one `list-sessions` fork every tmux lookup goes through
  src/lib/session/open-session.ts — Explicit session requests → create, attach or restart plans
  src/lib/discovery/             — Session discovery: scan/diff, live worktree sessions, worktree HEAD reader
  src/lib/keybindings/           — Customizable keybinding system
    registry.ts                  — Action catalog, presets (Normie/Vim), ActionId type
    resolver.ts                  — matchesKey, resolveAction, findConflict, descriptorFromKeypress
    hints.ts                     — Human-readable key display strings
    controls-data.ts             — Controls panel data logic (buildControlsRows, getBindingRows)
  src/lib/input/                 — KeyPress type (shell-agnostic ink-Key shape) + text-input handling
libs/app-core/                   — The React layer over @n10/core, shared by both shells
  src/lib/context/               — React state contexts (Config, Session, Sidebar, Nav, Modal, Toast, Layout…)
  src/lib/hooks/                 — Shell-agnostic hooks (useSessionManager, useDiffData, useRemoteComments…)
  src/lib/controllers/           — Headless screen controllers (diff file list / viewer view-models)
  src/lib/plan/use-plan-store.ts — useSyncExternalStore binding for core's plan store
libs/worktree-manager/           — Git worktree and branch operations
  src/lib/worktree.ts            — Worktree CRUD, branch utils, conflict checks
libs/terminal/                   — Terminal emulator (renderer) + SessionBackend interface
  src/lib/terminal-emulator.ts   — @xterm/headless wrapper with ANSI rendering
  src/lib/session-backend.ts     — SessionSpec and terminal connection/process lifecycle contract
libs/terminal-pty/               — Low-level node-pty transport used to embed the tmux client
  src/lib/pty-session.ts         — node-pty wrapper (PtySession)
libs/terminal-tmux/              — Required tmux backend (system tmux 3.2+)
  src/lib/tmux-cli.ts            — execFileSync wrappers for tmux subcommands (sessions, options, listing with user options)
  src/lib/tmux-backend.ts        — createTmuxBackend(spec, plan): tmux client connection and hosted-process observation
  src/lib/sanitize-tmux-session-name.ts — pure name sanitizer ('.',':' → '-', 200-char cap with hash tail)
  src/lib/is-tmux-available.ts   — version probe + platform-aware install hint
libs/kitty-graphics/             — Kitty terminal graphics protocol (Unicode placeholders)
  src/lib/kitty-graphics.ts      — detect, transmit (PNG f=100 / RGBA f=32+zlib), placeholderText, animation frames, delete
  src/lib/placement.ts           — px→cells placement heuristic (~10px/col, 2:1 aspect, 24-row cap)
libs/image-loader/               — Comment-image download + decode
  src/lib/image-format.ts        — magic-byte sniff + header-only dimensions (PNG/JPEG/GIF/WebP)
  src/lib/decode-image.ts        — PNG passthrough; JPEG/GIF/WebP → RGBA (@cwasm/webp wasm, lazy-loaded)
  src/lib/gif-animation.ts       — full composited RGBA frames + per-frame delays (native resolution)
  src/lib/fetch-image.ts         — auth-aware fetch (gh token bearer / Azure DevOps PAT basic)
```
