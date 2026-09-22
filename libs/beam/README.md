# beam

Pairs two machines and streams terminals and commands between them, replacing
SSH as the way one machine reaches another. beam does not replace tmux: tmux
still holds long-running agent processes and carries their identity. This
library has no git, worktree, tmux or n10-specific imports so it can be
published standalone later.

See `docs/beam.md` at the repository root for the full spec.

- Build: `npx nx build @n10/beam`
- Tests: `npx nx test @n10/beam`
