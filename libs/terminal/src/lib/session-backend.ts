/**
 * Process launch and local terminal connection contracts. Session identity,
 * metadata and lifecycle intent belong to the caller and transport launch plan.
 */

export interface SessionSpec {
  /** Command to run. The empty string means the backend's own default
   *  interactive shell: tmux runs its `default-shell`. Callers wanting
   *  "a terminal" rather than "this program" pass that. */
  cmd: string;
  args: string[];
  cwd: string;
  cols: number;
  rows: number;
  /** The caller's own additions over the inherited environment (e.g.
   *  seed variables), separate from the merged `env` below. Backends
   *  whose session host has its *own* environment (tmux: the server
   *  keeps the env it was started with) must deliver these into the
   *  session explicitly — the merged `env` only reaches the client
   *  process. */
  envAdditions?: Record<string, string | undefined>;
  /** Complete environment for the spawned process. `undefined` means
   *  "inherit the parent environment" — backends must not treat it as
   *  "empty environment", or the child loses PATH/HOME. Callers that
   *  need additions merge them over `process.env` themselves rather
   *  than passing a partial bag. */
  env?: Record<string, string | undefined>;
}

export interface SessionBackend {
  /** Actual persistent session name, after allocation or resolution. */
  readonly name?: string;
  /** Local client health, independent of the hosted process lifetime. */
  readonly connectionState?: 'connected' | 'reconnecting' | 'failed';
  /** Logical process status, independent of the local transport client. */
  readonly processState?: {
    running: boolean;
    exitCode?: number;
    signal?: number;
  };
  /** The local connection ended while the hosted process remained alive. */
  onDisconnect?(cb: () => void): void;
  offDisconnect?(cb: () => void): void;
  /** Manual retry after automatic reconnection has given up
   *  (`connectionState === 'failed'`) — the affordance behind a pane's
   *  "Reconnect" action. A no-op when there is nothing to retry (a
   *  backend with no transport to lose, or one not currently failed). */
  reconnect?(): void;
  readonly pid: number;
  readonly cols: number;
  readonly rows: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  onData(cb: (data: string) => void): void;
  offData(cb: (data: string) => void): void;
  onExit(cb: (code: number, signal?: number) => void): void;
  offExit(cb: (code: number, signal?: number) => void): void;
  /** Soft cleanup: release local resources. For the tmux backend this
   *  detaches the local PTY and leaves the tmux session running so it
   *  can be reattached on the next n10 start. */
  dispose(): void;
  /** Hard teardown: terminate the underlying session. For the tmux
   *  backend this runs `tmux kill-session` first, then disposes the
   *  local PTY. */
  kill(signal?: string): void;
}
