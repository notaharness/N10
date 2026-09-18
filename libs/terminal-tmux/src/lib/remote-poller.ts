/**
 * D3: one session poller per machine, not per backend. A remote backend
 * polling `tmux display-message` every 500ms per session (the way
 * `TmuxBackend` does locally) would cost one network round trip per
 * session per half-second. Instead, one `tmux list-sessions -F …` runs
 * on a ~1s interval and its result is fanned out to every backend
 * subscribed for that machine — one round trip regardless of how many
 * remote sessions are open on it.
 */
import type { MachineExecutor } from './tmux-cli.js';
import { tmuxListSessionsDetailedWith } from './tmux-cli-remote.js';

export interface PollState {
  /** Whether tmux still lists this session at all. */
  found: boolean;
  paneDead: boolean;
  exitCode?: number;
  exitSignal?: number;
}

export interface PollSubscriber {
  /** A successful list call reported this session's state (or its
   *  absence). Never fired for a call that failed outright. */
  onState(state: PollState): void;
  /** The list call itself failed — the machine could not be reached,
   *  not "this session exited". Must never be read as a process exit. */
  onUnreachable(): void;
}

const DEFAULT_INTERVAL_MS = 1000;

/** Consecutive failed polls required before a control-plane fault is
 *  reported to subscribers (finding 7, second pass): a single failed
 *  `list-sessions` used to drive every subscriber's `onUnreachable`
 *  straight into `enterReconnecting`, disposing a perfectly healthy
 *  pty handle and reattaching over a one-tick blip. This does not
 *  change what a *genuinely* down machine looks like — still no
 *  terminal state, only a longer "reconnecting" — it only keeps a
 *  routine hiccup from churning a healthy data plane. */
const UNREACHABLE_AFTER_MISSES = 2;

export class RemoteSessionPoller {
  private readonly subscribers = new Map<string, Set<PollSubscriber>>();
  private timer?: ReturnType<typeof setInterval>;
  private polling: Promise<void> | null = null;
  private disposed = false;
  private consecutiveFailures = 0;

  constructor(
    private readonly executor: MachineExecutor,
    private readonly intervalMs: number = DEFAULT_INTERVAL_MS
  ) {}

  /** Subscribe one backend's session name. The timer runs only while
   *  there is something to poll — same discipline as the reachability
   *  prober (beam-node-probe.ts) — and the first poll fires immediately
   *  so a backend attached mid-interval is not left waiting a full tick. */
  subscribe(name: string, subscriber: PollSubscriber): () => void {
    let set = this.subscribers.get(name);
    if (!set) {
      set = new Set();
      this.subscribers.set(name, set);
    }
    set.add(subscriber);
    this.ensureTimer();
    return () => {
      set!.delete(subscriber);
      if (set!.size === 0) this.subscribers.delete(name);
      if (this.subscribers.size === 0) this.stopTimer();
    };
  }

  private ensureTimer(): void {
    if (this.timer || this.disposed) return;
    this.timer = setInterval(() => void this.poll(), this.intervalMs);
    this.timer.unref?.();
    void this.poll();
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private poll(): Promise<void> {
    if (this.polling) return this.polling;
    const promise = this.runOnePoll().finally(() => {
      this.polling = null;
    });
    this.polling = promise;
    return promise;
  }

  private async runOnePoll(): Promise<void> {
    if (this.subscribers.size === 0) return;
    try {
      const sessions = await tmuxListSessionsDetailedWith(this.executor);
      this.consecutiveFailures = 0;
      // Read subscribers *after* the await, not a snapshot taken
      // before it: a backend that subscribes while this call is in
      // flight must still see this same tick's result rather than
      // waiting a full interval for the next one.
      const byName = new Map(sessions.map((s) => [s.name, s]));
      for (const name of [...this.subscribers.keys()]) {
        const info = byName.get(name);
        const state: PollState = info
          ? {
              found: true,
              paneDead: info.paneDead,
              exitCode: info.exitCode,
              exitSignal: info.exitSignal,
            }
          : { found: false, paneDead: false };
        for (const subscriber of this.subscribers.get(name) ?? [])
          subscriber.onState(state);
      }
    } catch {
      // The list call itself failed: the machine could not be reached
      // this tick. A single miss keeps polling silently — a routine
      // control-plane blip must not churn a healthy data plane — and
      // only `UNREACHABLE_AFTER_MISSES` consecutive misses tell every
      // subscriber "unreachable", never a state that reads as its
      // process having exited.
      this.consecutiveFailures += 1;
      if (this.consecutiveFailures < UNREACHABLE_AFTER_MISSES) return;
      for (const set of this.subscribers.values())
        for (const subscriber of set) subscriber.onUnreachable();
    }
  }

  dispose(): void {
    this.disposed = true;
    this.stopTimer();
    this.subscribers.clear();
  }
}
