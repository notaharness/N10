# n10

n10 runs coding agents in Git worktrees and lets you review their pull requests, from a desktop app or a terminal UI.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/media/hero.png">
  <source media="(prefers-color-scheme: light)" srcset="docs/media/hero-light.png">
  <img alt="n10 Desktop showing worktrees and pull request status beside a code diff with inline review comments" src="docs/media/hero.png">
</picture>

Every branch gets its own worktree and agent session, so you can have several features and reviews going at once without stashing changes or touching your main checkout. n10 shows each worktree's pull request, CI checks, reviews and conflicts. An agent can draft review comments for you to post, and you can hand review comments on your own pull requests to an agent as one task, without opening GitHub.com or Azure DevOps.

n10 works with Claude, Codex, Gemini, Copilot and OpenCode, and with GitHub and Azure DevOps. It is in beta: I use it every day, but expect rough edges.

Documentation: **[n10.is/docs](https://n10.is/docs)**

## Install

You need:

- Git, Node.js 20 or newer, and tmux 3.2 or newer.
- An agent CLI on your `PATH`, signed in: `claude`, `codex`, `gemini`, `copilot` or `opencode`.
- For GitHub, the [`gh` CLI](https://cli.github.com), signed in. For Azure DevOps, a personal access token.
- On Linux, `build-essential` and `python3`, to compile `node-pty` during the install.

Then:

```sh
npm install -g @notaharness/n10
```

A .deb package and an AppImage for Linux are coming ([#122](https://github.com/notaharness/n10/issues/122)).

## Use it

From a repository:

```sh
n10          # open n10 Desktop
n10 --tui    # or run the terminal UI
```

n10 reads your Git remote and fills in the project settings. Press `⌘N` (`Ctrl+N` on Linux and Windows), type a branch name and choose **Create branch … and open a worktree**. n10 creates the worktree and offers to launch your agent in it.

Agents run in tmux, so quitting n10 leaves them running, and n10 reconnects when you open it again. The [getting started guide](https://n10.is/docs/getting-started) walks through the rest.

### Work on several branches at once

Each worktree's row shows its pull request state, CI checks, reviews and conflicts. It turns red when a check fails or a reviewer asks for changes, and solid green when checks pass and every reviewer approves.

![Creating a branch and worktree from the command palette, then launching an agent](docs/media/worktrees.gif)

### Review with an agent

Ask an agent to review a pull request. It leaves draft comments on the diff, and you edit, discard, skip or post each one. Posted comments are yours.

![Working through an agent's draft review comments, posting one and skipping to the next](docs/media/review.gif)

### Send review comments to an agent

Add the review comments you want addressed to a plan, with a note on each if you like, preview the prompt, and send it to the branch's agent as one task.

![Adding review comments and instructions to a plan, previewing the prompt, and sending it to an agent](docs/media/plan.gif)

### Babysit a pull request

Right-click a pull request and choose **Babysit pull request**. n10 tells its agent about failing checks, new review comments and conflicts, batched and sent when the agent is idle.

![Enabling Babysit on a pull request and sending CI failures and review comments to its agent](docs/media/babysit.gif)

### Review pull requests in n10

Read a pull request's description, browse its diff, reply to and resolve threads, and submit your review. n10 Desktop also shows whole files, with unchanged code folded.

![Reading a pull request, switching diff views, and replying to and resolving a review thread](docs/media/review-in-place.gif)

### Light and dark themes

The most important feature of any software.

![The review workspace in dark and light themes](docs/media/theme.gif)

### The terminal UI

`n10 --tui` shares its configuration, worktrees and sessions with n10 Desktop. It covers worktrees, agents, pull request status, diffs, review threads and plans. Most new features land in n10 Desktop first.

![The terminal UI showing pull request status, inline review threads, and a plan ready to send to an agent](docs/media/tui.gif)

### Run agents on your other machines

n10 Desktop includes [Beam](https://github.com/notaharness/beam), which pools the machines you own. Join them into a fleet from n10's **Fleet** view, then launch worktrees and agents on any of them. See [Fleet](https://n10.is/docs/guides/fleet).

### Let one agent coordinate others

[Orchestra](https://github.com/notaharness/plugins/tree/main/orchestra) lets one coding agent hand work to other agents, each in its own worktree. n10 lists its players next to your own worktrees.

## Contributing

Pick up work from the [roadmap](https://github.com/orgs/notaharness/projects/1) or an issue labelled [`good first issue`](https://github.com/notaharness/n10/labels/good%20first%20issue); the [roadmap page](https://n10.is/docs/roadmap) explains the direction. [CONTRIBUTING.md](CONTRIBUTING.md) covers setup, checks, working with an AI agent and opening a pull request. Report vulnerabilities as described in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
