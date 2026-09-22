/**
 * D4: a `SessionBackend` over a remote machine's tmux session, reached
 * through a beam `pty` stream for data and a `MachineExecutor` for
 * control-plane commands (create, kill, capture-pane, the D3 poller's
 * list-sessions). `connectionState` (this stream's health) and
 * `processState` (what the D3 poller last reported) are driven by two
 * different sources on purpose — see decisions.md D4 and AGENTS.md: a
 * dropped connection must never render as the agent having exited.
 */
import type { SessionBackend, SessionSpec } from '@n10/terminal';
import { tmuxAttachArgs, type MachineExecutor } from './tmux-cli.js';
import { tmuxCapturePaneWith, tmuxKillSessionWith } from './tmux-cli-remote.js';
import { prepareRemoteTmuxSession } from './tmux-launch-remote.js';
import type { TmuxLaunchPlan } from './tmux-launch.js';
import type { RemoteSessionPoller } from './remote-poller.js';

/** One remote pty stream's client contract — deliberately narrow, the
 *  same seam shape as `TmuxSessionPreparer`: the desktop supplies a
 *  concrete implementation over `beam-node-bridge.ts`; this package
 *  never imports beam or Electron. */
export interface RemotePtyHandle {
  onData(cb: (data: string) => void): void;
  offData(cb: (data: string) => void): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  /**
   * The stream closed. Any reason: the remote `tmux attach-session`
   * client exited because the user detached with `C-b d`, the hosted
   * process ended, or the connection underneath went away. Nothing on
   * this side can tell those apart — the stream carries no reason
   * across the worker boundary — so the backend treats every close the
   * same way, by re-attaching, and does not read a closed stream as
   * evidence against the connection it was riding on. What is evidence
   * is in `RemotePtyOpenParams.reconnect`.
   */
  onClose(cb: () => void): void;
  /** Detach locally; the remote tmux session is left running. */
  dispose(): void;
}

export interface RemotePtyOpenParams {
  /** Absent or empty means the login shell (beam's D1). This backend
   *  always passes one (attaching a tmux client), but the type stays
   *  optional so a `RemotePtyOpener` is usable for a plain remote
   *  shell too. */
  argv?: string[];
  cwd?: string;
  env?: Record<string, string>;
  cols: number;
  rows: number;
  /**
   * The *connection* this attach will ride on is suspect, and an opener
   * that pools one per machine should verify it before reusing it —
   * three retries down a transport that can never answer are three
   * retries spent for nothing, and the manual Reconnect behind them
   * fails exactly the same way.
   *
   * Set only where there is evidence about the connection rather than
   * about one stream on it: the machine stopped answering control-plane
   * commands, or an attach over this connection has already failed. A
   * stream closing is not evidence — the remote tmux client exits when
   * the user detaches, and the hosted process exits when it is done,
   * and both of those happen over a connection that is working and
   * shared with every other pane on that machine plus its mailbox.
   * Verifying costs a round trip the caller must wait out, and acting
   * on a verification that fails costs every one of those streams.
   */
  reconnect?: boolean;
}

export interface RemotePtyOpener {
  open(params: RemotePtyOpenParams): Promise<RemotePtyHandle>;
}

/** Everything a remote backend needs for one machine: the beam peerId
 *  it addresses, an executor for tmux/git control commands, and an
 *  opener for the interactive pty stream. */
export interface RemoteMachine {
  id: string;
  executor: MachineExecutor;
  ptyOpener: RemotePtyOpener;
}

type ExitCallback = (code: number, signal?: number) => void;

function sanitizedEnv(spec: SessionSpec): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(spec.env ?? {})) {
    if (value != null && key !== 'TMUX' && key !== 'TMUX_PANE')
      env[key] = value;
  }
  return env;
}

const MAX_RECONNECT_ATTEMPTS = 3;

/** How long a re-attached stream must survive before the reconnection
 *  counts as successful — the same window `tmux-backend.ts` applies
 *  locally, so a flapping link exhausts its attempts and surfaces the
 *  Reconnect affordance on both transports (decisions.md D5). */
const STABLE_CONNECTION_MS = 2000;

export class RemoteTmuxBackend implements SessionBackend {
  readonly name: string;
  /** No local OS process backs a remote session. */
  readonly pid = 0;
  private handle: RemotePtyHandle;
  private readonly data = new Set<(data: string) => void>();
  private readonly exits = new Set<ExitCallback>();
  private readonly disconnects = new Set<() => void>();
  private connection: NonNullable<SessionBackend['connectionState']> =
    'connected';
  private state: NonNullable<SessionBackend['processState']> = {
    running: true,
  };
  private width: number;
  private height: number;
  private finalFrame: string | null = null;
  private reconnectAttempts = 0;
  /** Whether anything has said the *connection* is in doubt, as opposed
   *  to this one stream having ended. Reset only once a re-attach has
   *  held for the stability window, so a link that keeps failing keeps
   *  asking the opener to verify. */
  private transportSuspect = false;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private stableTimer?: ReturnType<typeof setTimeout>;
  private readonly unsubscribePoll: () => void;
  private disposed = false;
  private killed = false;

  constructor(
    private readonly spec: SessionSpec,
    name: string,
    private readonly machine: RemoteMachine,
    poller: RemoteSessionPoller,
    handle: RemotePtyHandle
  ) {
    this.name = name;
    this.width = spec.cols;
    this.height = spec.rows;
    this.handle = handle;
    this.bindHandle(handle);
    this.unsubscribePoll = poller.subscribe(name, {
      onState: (info) => this.handlePollState(info),
      // The poller speaks to the machine, not to this stream: it going
      // quiet is evidence about the connection itself.
      onUnreachable: () => this.enterReconnecting('unreachable'),
    });
  }

  private bindHandle(handle: RemotePtyHandle): void {
    for (const cb of this.data) handle.onData(cb);
    handle.onClose(() => {
      if (this.disposed || this.handle !== handle) return;
      this.enterReconnecting('stream-closed');
    });
  }

  private enterReconnecting(
    cause: 'stream-closed' | 'unreachable' | 'attach-failed'
  ): void {
    if (this.disposed) return;
    // Recorded before the guard: a machine that goes unreachable while
    // a reconnect is already in flight is still saying something about
    // the connection, and the retry after it should act on that.
    if (cause !== 'stream-closed') this.transportSuspect = true;
    if (!this.state.running || this.connection !== 'connected') return;
    this.connection = 'reconnecting';
    // A stream that dropped before the window elapsed was never a
    // successful reconnection: cancel the pending reset so a flapping
    // link accumulates attempts instead of restarting from zero.
    clearTimeout(this.stableTimer);
    for (const cb of [...this.disconnects]) cb();
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.disposed || !this.state.running) return;
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.connection = 'failed';
      return;
    }
    const delay = 500 * 2 ** this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => void this.attemptReconnect(), delay);
    this.reconnectTimer.unref?.();
  }

  /** Manual retry after `scheduleReconnect` gave up and `connectionState`
   *  read `failed` — the pane's "Reconnect" action (ux-machines.md §6).
   *  Resets the bounded attempt counter and tries immediately, rather
   *  than composing with the backoff it just exhausted. A no-op outside
   *  `failed`: nothing to retry while connected, and a reconnect already
   *  in flight owns its own retries. */
  reconnect(): void {
    if (this.disposed || !this.state.running || this.connection !== 'failed')
      return;
    this.connection = 'reconnecting';
    this.reconnectAttempts = 0;
    void this.attemptReconnect();
  }

  private async attemptReconnect(): Promise<void> {
    if (this.disposed || !this.state.running) return;
    try {
      const handle = await this.machine.ptyOpener.open({
        argv: ['tmux', ...tmuxAttachArgs(this.name)],
        cwd: this.spec.cwd,
        env: sanitizedEnv(this.spec),
        cols: this.width,
        rows: this.height,
        reconnect: this.transportSuspect,
      });
      // `dispose()` clears a *scheduled* retry; it cannot cancel one
      // already awaiting `open()`. Adopting this handle on a backend
      // that was torn down (or whose process exited) meanwhile leaks
      // the remote pty stream — nothing would ever dispose it.
      if (this.disposed || !this.state.running) {
        handle.dispose();
        return;
      }
      this.handle.dispose();
      this.handle = handle;
      this.bindHandle(handle);
      this.connection = 'connected';
      // A stream that survives the window is a successful
      // reconnection, exactly as in `tmux-backend.ts`. Resetting the
      // counter on `open()` alone lets a link that drops again inside
      // the window retry forever at the backoff floor instead of
      // reaching `failed`.
      clearTimeout(this.stableTimer);
      this.stableTimer = setTimeout(() => {
        this.reconnectAttempts = 0;
        this.transportSuspect = false;
      }, STABLE_CONNECTION_MS);
      this.stableTimer.unref?.();
      await this.replayFinalFrame();
    } catch {
      // An attach that failed *is* evidence about the connection, and
      // the one place this backend gets any: the next retry asks the
      // opener to verify rather than reusing the same transport again.
      this.transportSuspect = true;
      this.scheduleReconnect();
    }
  }

  private handlePollState(info: {
    found: boolean;
    paneDead: boolean;
    exitCode?: number;
    exitSignal?: number;
  }): void {
    if (this.disposed || !this.state.running) return;
    if (info.found && !info.paneDead) return;
    this.state = {
      running: false,
      exitCode: info.found ? info.exitCode : undefined,
      signal: info.found ? info.exitSignal : undefined,
    };
    this.unsubscribePoll();
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.stableTimer);
    // Best-effort: the exit itself is already reported below either
    // way. A `void` alone here is not error handling (root AGENTS.md)
    // — the capture-pane call this awaits can reject on any transport
    // failure, and an uncaught rejection in Electron main is a
    // process-level crash over what is otherwise a routine "the machine
    // went away right as the session ended" (finding 4).
    if (info.found) void this.replayFinalFrame().catch(() => undefined);
    for (const cb of [...this.exits])
      cb(this.state.exitCode ?? 0, this.state.signal);
  }

  private async replayFinalFrame(): Promise<void> {
    const frame = await tmuxCapturePaneWith(this.machine.executor, this.name);
    if (frame == null) return;
    const output =
      '\x1b[?1049l\x1b[3J\x1b[2J\x1b[H' + frame.replace(/\r?\n/g, '\r\n');
    this.finalFrame = output;
    for (const cb of [...this.data]) cb(output);
  }

  get connectionState() {
    return this.connection;
  }
  get processState() {
    return this.state;
  }
  get cols(): number {
    return this.width;
  }
  get rows(): number {
    return this.height;
  }
  write(data: string): void {
    this.handle.write(data);
  }
  resize(cols: number, rows: number): void {
    this.width = cols;
    this.height = rows;
    this.handle.resize(cols, rows);
  }
  onData(cb: (data: string) => void): void {
    this.data.add(cb);
    this.handle.onData(cb);
    if (this.finalFrame !== null && !this.disposed) cb(this.finalFrame);
  }
  offData(cb: (data: string) => void): void {
    this.data.delete(cb);
    this.handle.offData(cb);
  }
  onExit(cb: ExitCallback): void {
    this.exits.add(cb);
    if (!this.state.running)
      queueMicrotask(() => {
        if (!this.disposed && this.exits.has(cb))
          cb(this.state.exitCode ?? 0, this.state.signal);
      });
  }
  offExit(cb: ExitCallback): void {
    this.exits.delete(cb);
  }
  onDisconnect(cb: () => void): void {
    this.disconnects.add(cb);
  }
  offDisconnect(cb: () => void): void {
    this.disconnects.delete(cb);
  }

  /** Detach the local stream client. The remote tmux session is left
   *  running — a remote session survives closing n10 exactly as a
   *  local one does. A deliberate detach is not a connection failure
   *  (finding 10): `connectionState` is left as it was rather than
   *  forced to `'failed'`, which means "reconnection was attempted and
   *  gave up", not "this was closed on purpose". */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.stableTimer);
    this.unsubscribePoll();
    this.data.clear();
    this.exits.clear();
    this.disconnects.clear();
    this.handle.dispose();
  }

  /** Hard teardown: `tmux kill-session` on the machine first, then
   *  dispose. Never the other way — a killed session's data stream
   *  closing must not be misread as a connection drop worth retrying. */
  kill(): void {
    if (this.killed) return;
    this.killed = true;
    // Fire-and-forget: `dispose()` below tears this backend down
    // regardless of whether the remote kill-session call lands, so
    // there is nothing to await. But `void` alone does not catch a
    // rejection (finding 4) — on a flaky machine this is a routine
    // failure, not a process-level unhandled rejection.
    void tmuxKillSessionWith(this.machine.executor, this.name).catch(
      () => undefined
    );
    this.dispose();
  }
}

/** Constructed at the one site `createTmuxBackend` is
 *  (`libs/core/src/lib/session/open-session.ts`), branching on the
 *  machine in the session request. Runs the *same* `TmuxLaunchPlan`
 *  `createTmuxBackend` would, executed by `machine.executor` instead
 *  of a local fork (decisions.md D5), then attaches a `pty` stream. */
export async function createRemoteTmuxBackend(
  spec: SessionSpec,
  plan: TmuxLaunchPlan,
  machine: RemoteMachine,
  poller: RemoteSessionPoller
): Promise<SessionBackend> {
  const name = await prepareRemoteTmuxSession(machine.executor, spec, plan);
  const handle = await machine.ptyOpener.open({
    argv: ['tmux', ...tmuxAttachArgs(name)],
    cwd: spec.cwd,
    env: sanitizedEnv(spec),
    cols: spec.cols,
    rows: spec.rows,
  });
  return new RemoteTmuxBackend(spec, name, machine, poller, handle);
}
