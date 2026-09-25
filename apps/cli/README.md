# n10

Run AI coding agents across git worktrees, with pull-request review built in, from a desktop app or a terminal UI.

n10 gives every branch its own worktree and its own agent session. A pull request opens as a review workspace: the diff with inline comment threads beside the agent working on it. Agents can write draft review comments that you walk through and post. Sessions run under tmux, so closing n10 detaches from them rather than killing them, and the next launch reattaches.

> Beta. Expect rough edges, and pin a version if you depend on it.

## Install

```sh
npm install -g @notaharness/n10
```

Then, from inside any git repository:

```sh
n10                  # the desktop app
n10 --tui            # the terminal UI, or: n10 --tui /path/to/repo
```

Launching the desktop app from a repository opens it; from anywhere else it reopens your last repository, or the repository picker on first run. The first run walks you through connecting your version control provider.

## Requirements

- **Node.js 22.12+** and **git**.
- **A build toolchain on Linux.** `node-pty` ships prebuilt binaries for macOS and Windows, but not Linux, so npm compiles it during install. On Debian/Ubuntu: `sudo apt install build-essential python3`. macOS needs the Xcode command line tools (`xcode-select --install`).
- **An agent CLI** on your `PATH` — `claude`, `codex`, `copilot`, `gemini` or `opencode`.
- **`tmux` 3.2 or newer.** Agents and terminals run in tmux and survive quitting n10.
- **`gh` or `az` (optional)** for pull-request features, on GitHub and Azure DevOps respectively.

The first launch of the desktop app downloads Electron's binary (~100–200 MB); the terminal UI does not need it. The desktop app needs a 64-bit system, and macOS 13 or later on a Mac.

### Windows

Run it under WSL 2, which gives you the unix environment the agent and tmux backends expect. WSLg renders the desktop app as a normal Windows window. Keep your repositories on the Linux filesystem (`~/code/...`) rather than `/mnt/c/...`; git across the filesystem boundary is much slower.

## What it does

- **Worktree per branch.** Check out a branch as a worktree, launch an agent in it, and remove branch, worktree and session together when you're done. Merged branches can be cleaned up automatically.
- **Pull request review.** Diffs with comment threads inline, replied to and resolved without leaving n10. The desktop app adds whole-file diffs with folding, split and unified views, and word-level highlighting; the terminal UI renders comment images inline on kitty and Ghostty.
- **Agent-written reviews.** An agent reviewing a pull request records its draft comments with `n10 util add-comment`, and you step through them by severity to edit, discard or post.

Settings live in the app (`⌘,` / `Ctrl+,` on the desktop, `s` in the terminal UI) and are stored in `~/.n10/`.

## Links

- [Source](https://github.com/notaharness/n10)
- [Issues](https://github.com/notaharness/n10/issues)

MIT
