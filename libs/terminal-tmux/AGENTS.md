# libs/terminal-tmux — persistent session transport

Requires system tmux ≥ 3.2 for per-session environment flags. The package
contains no n10 identity, agent or Orchestra policy. Core supplies an
explicit serializable `TmuxLaunchPlan` to async `createTmuxBackend`:

- `create`: allocate a sanitized free label, install tags and retention options,
  then start the requested command. A temporary idle process keeps the session
  present while metadata is written. Failed creation cleans up only that newly
  allocated session.
- `attach`: connect to the exact target without rewriting tags or running a
  command. Retained exited panes can be attached for their output.
- `restart`: require a dead pane and use native `respawn-pane` without `-k`, so a
  concurrent restart cannot terminate a live process.

`dispose()` releases the local PTY client and polling timer; the hosted process
survives. `kill()` terminates the exact tmux session. `onExit` reports hosted
process exit, including retained panes; `onDisconnect` reports a local client
ending while the hosted process is still running. The backend reconnects its
client with bounded backoff while preserving the local subscriptions and size. Native `pane_dead` and exit
status drive lifecycle information; no global tmux hooks are installed.

## Safety and protocol

- `vitest.setup.ts` pins a scratch HOME and `TMUX_TMPDIR` and drops `$TMUX` before tests
  load. `assertScratchTmuxSocket` fails if either is lost. `$TMUX` overrides
  `TMUX_TMPDIR`; never run tests against the developer's live server.
- Never `tmux kill-server`. Test cleanup kills individual fixture sessions.
- Names are labels. Creation skips occupied names and retries duplicate-session
  races. Every lookup, kill, option and attach target uses the exact `=name:`
  form; a missing name must not match another session by prefix.
- The server retains its initial environment. Explicit launch additions plus
  HOME/PATH are injected into the hosted process, not just the local client.
  tmux gives a new pane the PATH of the client that spawned it over the
  session's `-e PATH`, so that client runs with the pinned PATH as well.
- Parsed command output uses `-u`, preventing a non-UTF-8 locale from rewriting
  column separators. Detailed discovery reads creation time, native pane state,
  requested user options and working directory in one command.

Desktop installs a `setTmuxSessionPreparer` callback that runs new-session
preparation in an Electron utility process. Node applications use the default
native preparer. Plans carry excluded names as data; callbacks do not cross the
process boundary. The returned target is attached directly without preparing
or rewriting it again. Preparation owns cleanup on failure, so callers must
not terminate its worker midway through creating a session.
