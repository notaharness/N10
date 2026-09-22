# n10

A terminal UI for running AI coding agents across git worktrees, with pull-request review built in.

n10 gives every branch its own worktree and its own agent session, and puts them behind one sidebar: branch, pull request state, CI, review status. Open a pull request and you get the diff with its comment threads next to the agent working on it. Sessions run under tmux, so quitting n10 detaches from them rather than killing them, and the next launch reattaches.

This is the terminal UI. The desktop app ships separately as [`@notaharness/n10-desktop`](https://www.npmjs.com/package/@notaharness/n10-desktop) and shares the same core.

> Beta. Expect rough edges, and pin a version if you depend on it.

## Install

```sh
npm install -g @notaharness/n10@beta
```

Then, from inside any git repository:

```sh
n10          # or: n10 /path/to/repo
```

The first run walks you through connecting your version control provider.

## Requirements

- **Node.js 20+** and **git**.
- **A build toolchain on Linux.** `node-pty` ships prebuilt binaries for macOS and Windows, but not Linux, so npm compiles it during install. On Debian/Ubuntu: `sudo apt install build-essential python3`. macOS needs the Xcode command line tools (`xcode-select --install`).
- **An agent CLI** on your `PATH` — `claude`, `codex`, `copilot`, `gemini` or `opencode`.
- **`tmux` 3.2 or newer.** Agents and terminals run in tmux and survive quitting n10.
- **`gh` or `az` (optional)** for pull-request features, on GitHub and Azure DevOps respectively.

## What it does

- **Worktree per branch.** Check out a branch as a worktree, launch an agent in it, and remove branch, worktree and session together when you're done.
- **Pull request review.** Whole-file diffs with comment threads inline, replied to and resolved without leaving the terminal. Images in comments render inline on kitty and Ghostty.
- **Agent-written reviews.** An agent reviewing a pull request records its draft comments with `n10 util add-comment`, and you walk through them to edit, discard or post.

## For desktop users

`n10 util add-comment` is how a review agent records its comments, and it ships only in this package. [`@notaharness/n10-desktop`](https://www.npmjs.com/package/@notaharness/n10-desktop) needs `n10` on your `PATH` for agent-written reviews; everything else there works without it.

## Links

- [Source](https://github.com/notaharness/n10)
- [Issues](https://github.com/notaharness/n10/issues)

MIT
