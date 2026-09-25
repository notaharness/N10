# Contributing to n10

## Pick something to work on

Planned work lives on the [n10 roadmap](https://github.com/orgs/notaharness/projects/1),
grouped by epic. Issues labelled
[`good first issue`](https://github.com/notaharness/n10/labels/good%20first%20issue)
are small and fully specified. Comment on an issue before you start so nobody
duplicates the work.

To propose something new, [open an issue](https://github.com/notaharness/n10/issues/new/choose)
first. Describe the outcome you want and how we'd know it's done.

## Set up

You need Node.js 20 or newer, Git and tmux 3.2 or newer. On Linux, also install
`build-essential` and `python3` so `node-pty` compiles.

```sh
git clone https://github.com/notaharness/n10.git
cd n10
npm ci
```

Use `npm ci`, not `npm install`, so you get the locked dependency tree.

## Run and check

```sh
npx nx serve cli                      # rebuild dependencies and run the TUI
npx nx test <project>                 # unit tests
npx nx run-many -t lint --all         # warnings fail too
npx nx run-many -t typecheck --all
npx nx e2e cli-e2e                    # offline TUI tests
npx nx e2e desktop-e2e                # offline Electron tests
```

`AGENTS.md` lists the rest, including visual and live integration tests.

CI runs lint, tests, typecheck, builds and end-to-end tests on every pull
request. A pre-commit hook runs lint on staged files. See
[`docs/testing.md`](docs/testing.md) for test fixtures and visual QA.

## Work with an AI agent

[`AGENTS.md`](AGENTS.md) holds the repository's instructions for agents:
commands, boundaries between packages and working conventions. Some folders
add their own `AGENTS.md` with local rules.

- Codex reads `AGENTS.md` on its own.
- Claude Code reads `CLAUDE.md`, which imports `AGENTS.md`.
- Tell any other agent to read `AGENTS.md`.

Not every agent loads the nested files, so ask it to read each `AGENTS.md`
between the root and the files it changes.

[`docs/agent-context.md`](docs/agent-context.md) has the details.

Give the agent the issue, including its acceptance criteria, as the task.
Review its changes before you open a pull request.

## Open a pull request

- Implement one issue per pull request, and link it in the description, for
  example `Closes #123`.
- Branch from `master`. Use [Conventional Commits](https://www.conventionalcommits.org/)
  with a project scope, such as `fix(desktop):` or `feat(core):`.
- Add or update tests for the behavior you change.
- Fill in the pull request template.
- Keep it small. Split unrelated changes into separate pull requests.

By contributing, you agree that your contributions are licensed under the
[MIT License](LICENSE).
