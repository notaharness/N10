import type { SessionBackend, SessionSpec } from '@n10/terminal';
import { PtySession } from '@n10/terminal-pty';
import {
  tmuxAttachArgs,
  tmuxCapturePane,
  tmuxKillSession,
  tmuxPaneStateAsync,
  type TmuxPaneRead,
} from './tmux-cli.js';
import { prepareTmuxSession, type TmuxLaunchPlan } from './tmux-launch.js';
export type { TmuxLaunchPlan } from './tmux-launch.js';

type ExitCallback = (code: number, signal?: number) => void;

export type TmuxSessionPreparer = (
  spec: SessionSpec,
  plan: TmuxLaunchPlan
) => string | Promise<string>;
let prepare: TmuxSessionPreparer = prepareTmuxSession;

/** Desktop supplies an isolated process for server creation; Node callers use native tmux. */
export function setTmuxSessionPreparer(
  preparer: TmuxSessionPreparer = prepareTmuxSession
): void {
  prepare = preparer;
}

/** Explicit create, attach or restart; no identity interpretation in the transport. */
export async function createTmuxBackend(
  spec: SessionSpec,
  plan: TmuxLaunchPlan
): Promise<SessionBackend> {
  const name = await prepare(spec, plan);
  return new TmuxBackend(spec, name, plan.mode === 'create');
}

class TmuxBackend implements SessionBackend {
  private inner: PtySession;
  private readonly data = new Set<(data: string) => void>();
  private finalFrame: string | null = null;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private stableTimer?: ReturnType<typeof setTimeout>;
  private reconnectAttempts = 0;
  private connection: NonNullable<SessionBackend['connectionState']> =
    'connected';
  private readonly spec: SessionSpec;
  private width: number;
  private height: number;
  private readonly exits = new Set<ExitCallback>();
  private readonly disconnects = new Set<() => void>();
  private timer?: ReturnType<typeof setInterval>;
  private disposed = false;
  private killed = false;
  /** Guards against overlapping polls: the async pane-state read can still
   *  be in flight when the next 500ms tick fires. The client's own
   *  `onExit` waits for whatever is here to settle rather than joining
   *  it — a read already in flight when the client exits may have been
   *  dispatched before the hosted process was, and so answer stale. */
  private inspecting: Promise<void> | null = null;
  private state = {
    running: true,
    exitCode: undefined as number | undefined,
    signal: undefined as number | undefined,
  };
  readonly name: string;

  constructor(spec: SessionSpec, name: string, created: boolean) {
    this.name = name;
    this.spec = spec;
    this.width = spec.cols;
    this.height = spec.rows;
    try {
      this.inner = this.attach();
    } catch (error) {
      if (created) tmuxKillSession(this.name);
      throw error;
    }
    // Retained panes do not terminate the client when their process exits.
    // Polling is local, bounded per command and stopped at dispose or exit.
    this.timer = setInterval(() => this.inspect(), 500);
    this.timer.unref();
    // Callers await creation before subscribing. Let those subscriptions bind
    // before inspecting an already-exited process and replaying its final frame.
    setTimeout(() => this.inspect(), 0).unref();
  }

  private attach(): PtySession {
    const env = { ...(this.spec.env ?? process.env) };
    delete env.TMUX;
    delete env.TMUX_PANE;
    const client = new PtySession('tmux', tmuxAttachArgs(this.name), {
      cols: this.width,
      rows: this.height,
      cwd: this.spec.cwd,
      env,
    });
    for (const cb of this.data) client.onData(cb);
    client.onExit(() => {
      if (this.disposed || this.inner !== client) return;
      clearTimeout(this.stableTimer);
      // A read already in flight when the client exits may have been
      // dispatched before the hosted process did and so resolve with a
      // stale "alive" result. Let it settle — its own handlePaneState
      // still runs and may already conclude the exit — then issue a
      // fresh read of our own (never the stale one) before deciding
      // this is a mere client disconnect rather than a real exit.
      const stale = this.inspecting ?? Promise.resolve();
      void stale
        .then(() => this.runInspect())
        .then(() => {
          // Two tmux forks have passed; re-check identity as well as state.
          if (this.disposed || !this.state.running || this.inner !== client)
            return;
          this.connection = 'reconnecting';
          for (const cb of [...this.disconnects]) cb();
          this.scheduleReconnect();
        });
    });
    return client;
  }

  private scheduleReconnect(): void {
    if (this.disposed || !this.state.running) return;
    if (this.reconnectAttempts >= 3) {
      this.connection = 'failed';
      return;
    }
    const delay = 500 * 2 ** this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      if (this.disposed || !this.state.running) return;
      this.inner.dispose();
      try {
        this.inner = this.attach();
        this.connection = 'connected';
        // A client that survives two seconds is a successful reconnection.
        this.stableTimer = setTimeout(() => {
          this.reconnectAttempts = 0;
        }, 2000);
        this.stableTimer.unref();
      } catch {
        this.scheduleReconnect();
      }
    }, delay);
    this.reconnectTimer.unref();
  }

  /** Manual retry after `scheduleReconnect` gave up and `connectionState`
   *  read `failed` — the pane's "Reconnect" action (ux-machines.md §6).
   *  Mirrors `RemoteTmuxBackend.reconnect`: resets the bounded attempt
   *  counter and tries right away. */
  reconnect(): void {
    if (this.disposed || !this.state.running || this.connection !== 'failed')
      return;
    this.connection = 'reconnecting';
    this.reconnectAttempts = 0;
    try {
      this.inner.dispose();
      this.inner = this.attach();
      this.connection = 'connected';
      this.stableTimer = setTimeout(() => {
        this.reconnectAttempts = 0;
      }, 2000);
      this.stableTimer.unref?.();
    } catch {
      this.scheduleReconnect();
    }
  }

  /** Fire-and-forget entry point for the timer and the initial
   *  `setTimeout(0)`; overlapping ticks just join the read already
   *  in flight rather than starting a second one. */
  private inspect(): void {
    if (!this.state.running || this.disposed) return;
    void this.runInspect();
  }

  /** Async so the periodic poll never blocks the caller's event loop
   *  (Ink's render loop, Electron's main process). Returns the shared
   *  in-flight read so an overlapping timer tick joins it rather than
   *  starting a redundant one. */
  private runInspect(): Promise<void> {
    if (this.inspecting) return this.inspecting;
    const promise = tmuxPaneStateAsync(this.name)
      .then((pane) => this.handlePaneState(pane))
      .finally(() => {
        this.inspecting = null;
      });
    this.inspecting = promise;
    return promise;
  }

  private handlePaneState(read: TmuxPaneRead): void {
    // Disposal (or the process having already been marked exited by an
    // earlier poll) can land between the read starting and resolving.
    if (this.disposed || !this.state.running) return;
    // A failed read (non-zero exit, spawn error) says nothing about the
    // pane — n10 simply could not talk to tmux this tick. Leave
    // `state.running` and the timer untouched; the next tick tries again.
    if (read.status === 'failed') return;
    if (read.status === 'ok' && !read.state.paneDead) return;
    if (read.status === 'ok') this.replayFinalFrame();
    this.state = {
      running: false,
      exitCode: read.status === 'ok' ? read.state.exitCode : undefined,
      signal: read.status === 'ok' ? read.state.exitSignal : undefined,
    };
    clearInterval(this.timer);
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.stableTimer);
    for (const cb of [...this.exits])
      cb(this.state.exitCode ?? 0, this.state.signal);
  }

  private replayFinalFrame(): void {
    const frame = tmuxCapturePane(this.name);
    if (frame == null) return;
    // A process may exit before its client's first redraw. Replay the
    // retained frame, including history, before any listener handles exit.
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
  get pid(): number {
    return this.inner.pid;
  }
  get cols(): number {
    return this.width;
  }
  get rows(): number {
    return this.height;
  }
  write(data: string): void {
    this.inner.write(data);
  }
  resize(cols: number, rows: number): void {
    this.width = cols;
    this.height = rows;
    this.inner.resize(cols, rows);
  }
  onData(cb: (data: string) => void): void {
    this.data.add(cb);
    this.inner.onData(cb);
    if (this.finalFrame !== null && !this.disposed) cb(this.finalFrame);
  }
  offData(cb: (data: string) => void): void {
    this.data.delete(cb);
    this.inner.offData(cb);
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

  /** Detach the local client without terminating the hosted process. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.connection = 'failed';
    clearInterval(this.timer);
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.stableTimer);
    this.data.clear();
    this.exits.clear();
    this.disconnects.clear();
    this.inner.dispose();
  }

  kill(): void {
    if (this.killed) return;
    this.killed = true;
    tmuxKillSession(this.name);
    this.dispose();
  }
}

export { isTmuxAvailable } from './is-tmux-available.js';
