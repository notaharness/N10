# N10

Run AI coding agents across git worktrees, track pull requests, and review code from a desktop app or terminal UI.

I built n10 to help with my daily work in a large monorepo. I usually have several features and reviews going at once, and wanted one place to manage their branches and agent sessions. I also wanted help reviewing pull requests while still understanding the code I was approving.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/media/hero.png">
  <source media="(prefers-color-scheme: light)" srcset="docs/media/hero-light.png">
  <img alt="n10 Desktop showing worktrees and pull request status beside a code diff with inline review comments" src="docs/media/hero.png">
</picture>

n10 works with Claude, Codex, Gemini, Copilot, and OpenCode. You can choose a different agent for each project. It supports GitHub and Azure DevOps, with [different levels of test coverage](#version-control-providers).

> n10 is still early in development. We use it every day, but expect rough edges and breaking changes.

## Getting started

### Prerequisites

You'll need:

- Git, Node.js, npm, and tmux 3.2 or newer.
- An agent CLI on your `PATH`: `claude`, `codex`, `gemini`, `copilot`, or `opencode`.
- For GitHub, the `gh` CLI, signed in to your account.
- For Azure DevOps, a personal access token with repository and pull request access.
- On Linux, `build-essential` and `python3` to compile `node-pty` during installation.

n10 runs agents and terminal tabs in tmux. Quitting n10 detaches from them; reopening n10 reconnects to surviving sessions. Exited agents keep their final output so you can resume the recorded agent or explicitly start a new conversation. Closing a terminal tab or stopping an agent ends its tmux session.

### Installation

One package holds the desktop app and the terminal UI:

```sh
npm install -g @notaharness/n10
```

Run `n10` from your project directory to open the desktop app, or `n10 --tui` for the terminal UI. On the first run, n10 walks you through connecting your version control provider.

## Features

### Work on several branches at once

Each branch gets its own git worktree and agent session. You can keep several features in progress without stashing changes or disturbing your main checkout.

The sidebar shows each worktree's pull request state, CI results, review status, and conflict count. The status indicator turns red when a build fails or a reviewer rejects the changes. It turns solid green when CI passes and all reviewers approve.

n10 also detects merged branches and conflicts with the base branch. You can enable automatic cleanup of merged worktrees and use a shortcut to rebase onto the latest `main` or `master`.

![Creating a branch and worktree from the command palette, then launching an agent](docs/media/worktrees.gif)

### Review an agent's draft comments

Ask an agent to review a pull request. It adds draft comments to the relevant lines in the diff, and you work through them in severity order. Edit, discard, skip, or post each comment; published comments are attributed to you.

![Working through an agent's draft review comments, posting one and skipping to the next](docs/media/review.gif)

### Turn review comments into an agent task

Select the review comments you want an agent to address and add them to a plan. You can include instructions for individual comments, then preview the full prompt before sending the plan to your agent as a single task.

![Adding review comments and instructions to a plan, previewing the prompt, and sending it to an agent](docs/media/plan.gif)

### Babysit a pull request

Right-click a pull request and choose **Babysit** to keep your agent updated on CI results, unresolved review comments, and merge conflicts. n10 groups updates together and sends them to the agent's session when it's idle.

![Enabling Babysit on a pull request and sending CI failures and review comments to its agent](docs/media/babysit.gif)

### Review code without leaving n10

Read a pull request's description, browse its diff, and submit your review in n10. You can reply to comments, resolve or reopen threads, and switch between split and unified diff views.

The desktop app also supports whole-file diffs with code folding and word-level highlighting.

![Reading a pull request, switching diff views, and replying to and resolving a review thread](docs/media/review-in-place.gif)

### Light and dark themes

The most important feature of any software.

![The review workspace in dark and light themes](docs/media/theme.gif)

## The terminal UI

Run `n10 --tui` from your repository root to open the terminal UI. It shares the desktop app's core, configuration, and worktrees, so you can use either interface with the same projects.

You can check pull request status, read diffs and review threads, and send plans to agents from the terminal. Most development now focuses on the desktop app; some features, such as whole-file diffs, are only available there.

![The terminal UI showing pull request status, inline review threads, and a plan ready to send to an agent](docs/media/tui.gif)

## Configuration

Open settings with `s` in the terminal UI or `⌘,` / `Ctrl+,` on the desktop. From there, you can choose your version control provider and AI agent, set sync intervals, and configure automatic rebasing and cleanup of merged branches. Auto-detect can fill in project settings from your git remote.

For keyboard shortcuts, open the **Controls** panel. Choose the Normie or Vim preset, or remap individual actions.

n10 stores its configuration in `~/.n10/`.

## Version control providers

| Provider     | Authentication         | Test coverage                                        |
| ------------ | ---------------------- | ---------------------------------------------------- |
| GitHub       | Authenticated `gh` CLI | Unit, offline end-to-end, and live integration       |
| Azure DevOps | Personal access token  | Unit tests and recorded API responses; no live tests |

GitLab, Bitbucket, and other providers are not currently supported.

Azure DevOps tests use recorded responses, so CI may miss changes to the live service. Bug reports help us catch those gaps.

Providers share an interface in `libs/vcs/`. Contributions adding support for other providers are welcome.

### Pair with Orchestra

Pair n10 with my [Orchestra plugin](https://github.com/HermannBjorgvin/agent-plugins/tree/main/orchestra) to let your agent launch and coordinate worktree sessions you can follow in n10.
