# libs/core — @n10/core

The shell-agnostic half: git, worktrees, PTY and session infrastructure,
config, providers, keybindings, the plan store, pure helpers. No react, ink,
electron or `@n10/app-core` (lint-enforced). `src/plan.ts` is the
browser-safe entry (`@n10/core/plan`); nothing under it may touch `node:`.
The reasoning behind each rule is in `docs/decisions.md`.

- **Tmux requirement** (`session-backend.ts`): await `probeTmuxAvailability()`
  before startup validation. Require tmux 3.2+. Legacy backend preferences are
  ignored; no direct-agent PTY fallback exists.
- **Launch boundary** (`session/open-session.ts`): receive explicit worktree or
  terminal identity, validate the worktree HEAD, resolve tags, then choose
  create/attach/restart. Build agent argv only for create or restart. The tmux
  package receives opaque launch plans; it must not infer n10 identities.
- **Registry identity** (`session-key.ts`): worktree keys encode repo and exact
  branch; terminal keys encode the allocated tmux target. Both gain an
  _optional trailing_ machine segment (a beam `peerId`), omitted entirely when
  local, so every existing call site keeps producing byte-identical keys.
  `sessionIdentity` switches on kind (`value[0]`) first, then reads
  positionally with the optional machine — never on tuple length and kind
  together, since a remote terminal key and a local worktree key are both
  length-3 tuples. Labels never address entries. The registry owns
  connections, rendering and activity, not launch policy. `dispose()`
  detaches; `kill()` terminates; shutdown must dispose.
- **Shared identity** (`session-identity.ts`, `session-resolver.ts`): names are
  labels, `@orchestra-*` tags are identity. Attach and continuation preserve
  creator/reporting tags. Fresh conversations preserve creator/repo/branch but
  clear supervisor and last-report tags; record the actual launched agent.
  Replacing a live process requires its captured native incarnation and an
  atomic tmux guard. Unconfirmed restarts never interrupt a live winner.
  Untagged sessions are foreign. Never use config `projectKey` for tmux identity.
- **Agent restart** (`session/launch-session.ts`): continuation selects the
  recorded agent and its explicit resume adapter. Fresh launch selects the
  user's choice or configured default. Missing metadata must not silently
  redirect a continuation to a different agent.
- **Discovery** (`discovery/`): poll and use pure `diffScans`; attach through the
  shared launcher, rechecking connection state between awaits. Retired names
  are suppressed. Observe worktree processes, orphaned sessions and standalone
  terminals in one listing. Retained agent panes are not running processes.
- **Terminal sessions** (`terminal/launch-terminal.ts`): explicit shell/agent
  requests use the same launcher as worktrees. Allocate the final tmux name
  before creating the registry key. Agent panes retain final output; shell
  exits close their tabs. Native pane state controls exit, not client disconnect.

- **Session launch** (`session/`) resolves the worktree via `createWorktree`
  (exact branch match, rejecting a derived path occupied by another branch), reads config from the
  repo root, and only replaces a live session with explicit incarnation approval. Force-remove is offered only
  for 'uncommitted changes' and 'not pushed to upstream'.
- **Plan** (`plan/`): items are value snapshots taken at add time.
  `composePlanPrompt` numbers items in `planRows` order. Checkout is
  three-state: inject into a live agent, respawn, or create the worktree and
  spawn.
- **Babysit** (`babysit/`): the baseline is what the agent was told, not what
  was last seen. Send after ten minutes of quiet or thirty at most, only while
  the agent has been idle thirty seconds (`idleFor`). Spawn only through
  `checkoutWorktree` (existing branch) with `seed`, never `continue-or-seed`.
  Every git call takes `cwd`; ask `live()` after each await. Fetches go through
  `sync/fetch-queue.ts`; the merge check is `sync/conflicts.ts` so badge and
  briefing agree. `onStatus` fires on transitions only. Timing overrides:
  `babysitTimingFromEnv`.
- **Pull request cache** (`pull-requests/pull-request-cache.ts`): shared per-repo provider reads at `prPollInterval`. Only the newest fetch
  commits; a credentials change clears all. `lookupPullRequest` distinguishes
  `gone` from `unknown`, and one absence is not an answer.
- **Git output streams** (`utils/git-run.ts`): `runGit` spawns, returns what
  arrived plus `truncated`, rejects only when git failed. `execFile` discards
  everything on overflow. `fetchWorktreeDiffText` (`utils/worktree-diff.ts`)
  bounds per file before diffing (`lstat` bytes, churn lines, a rename
  excludes both paths) and trims overruns at a file boundary; the PR path
  keeps every file. Untracked files are assembled by hand, never `git add -N`,
  and symlinks render as mode-120000 patches. Git-backed cases live in
  `worktree-diff.integration.spec.ts`.
- **Sync** (`sync/`): `sweepMergedBranches`, conflict counts. `asyncOps.run`
  never rejects; errors go through `setOperationErrorHandler`.
- `keybindings/registry.ts` is the action catalog and carries a 900-line
  ceiling on purpose. Presets: Normie, Vim.
- No recursive `fs.watch` over a checkout; `node_modules` alone exhausts the
  inotify default.
