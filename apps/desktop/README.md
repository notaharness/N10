# n10 Desktop

A desktop app for running AI coding agents across git worktrees, with pull-request review built in.

n10 gives every branch its own worktree and its own agent session, and puts them in tabs. A pull request opens as a review workspace: the diff with inline comment threads on one side, the agent's terminal on the other. Agents can write draft review comments that you walk through and post. Sessions run under tmux when available, so they survive closing the app.

This is the GUI. The terminal UI ships separately as [`@notaharness/n10`](https://www.npmjs.com/package/@notaharness/n10) and shares the same core — install it too, because it is also how review agents write their comments (see Requirements).

> Beta. Expect rough edges, and pin a version if you depend on it.

## Install

```sh
npm install -g @notaharness/n10-desktop@beta
npm install -g @notaharness/n10          # for agent-written reviews
```

Then, from inside any git repository:

```sh
n10-desktop
```

Launching from a repository opens it directly; launching from anywhere else brings up the repository picker.

## Requirements

- **Node.js 20+** and **git**.
- **A build toolchain on Linux.** `node-pty` ships prebuilt binaries for macOS and Windows, but not Linux, so npm compiles it during install. On Debian/Ubuntu: `sudo apt install build-essential python3`. macOS needs the Xcode command line tools (`xcode-select --install`); most machines already have them.
- **An agent CLI** on your `PATH` — `claude`, `codex`, `copilot`, `gemini` or `opencode`. Configurable in Settings.
- **`tmux` 3.2 or newer.** Agents and terminal tabs run in tmux, survive quitting n10, and reattach on the next launch.
- **`gh` or `az` (optional)** for pull-request features, on GitHub and Azure DevOps respectively.

Installing pulls Electron's binary (~100–200 MB) on first install.

### Windows

Run it under WSL 2, which gives you the unix environment the agent and tmux backends expect. WSLg renders the app as a normal Windows window. Keep your repositories on the Linux filesystem (`~/code/...`) rather than `/mnt/c/...` — git across the filesystem boundary is dramatically slower.

## What it does

- **Worktree per branch.** Check out any branch as a worktree from the command palette; remove it (branch and session included) when you're done. Merged branches are cleaned up automatically, unless an agent is still working in one.
- **Agent sessions in tabs.** Launch an agent on a branch, watch it work, and keep its scrollback when you switch tabs. Tabs show when an agent is busy and flag it when it finishes something you haven't looked at.
- **Pull request review.** Whole-file diffs with folding, split and unified views, and word-level highlighting. Comment threads render inline, including images behind provider auth. Reply, resolve and submit your verdict without leaving the app.
- **Agent-written reviews.** Launch an agent to review a PR and it writes draft comments anchored to lines, through `n10 util add-comment`. Step through them by severity, edit or discard, and post.

## Configuration

Settings live in the app (⌘, / Ctrl+,) and are stored in `~/.n10/`. Provider credentials, the agent command, keybinding preset (Normie or Vim) and poll intervals are all configurable there.

## Links

- [Source](https://github.com/notaharness/n10)
- [Issues](https://github.com/notaharness/n10/issues)

MIT
