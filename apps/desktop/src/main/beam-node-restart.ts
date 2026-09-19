import type { UtilityProcess } from 'electron';

/**
 * The beam worker's supervision policy, split out of
 * `beam-node-bridge.ts` so the bridge is left with the request/response
 * call and the event forwarding: when a replacement may fork, how long
 * after the exit, and when a worker has earned its retries back.
 *
 * Bounded and exponential: a worker that keeps exiting after it
 * successfully started gets a handful of increasingly spaced-out
 * chances before this gives up. A startup failure never reaches here at
 * all — `beam-node-worker.ts` catches its own construction throw and
 * stays up to report it. Giving up leaves the last synthetic
 * "unreachable" push on screen, which is better than an unbounded fork
 * loop with nothing to show for it.
 */
const RESTART_BASE_DELAY_MS = 500;
const RESTART_MAX_DELAY_MS = 30_000;
const MAX_RESTART_ATTEMPTS = 5;

/** How long a worker must stay up, having spoken at least once, before
 *  its retries are handed back. A message alone only proves the worker
 *  reached the point of answering — a worker that answers one request
 *  and then dies, every time, does that on every cycle, so resetting on
 *  the message itself means the cap is never reached and the loop is as
 *  unbounded as having no cap at all. Staying up is the part a
 *  crash-looping worker cannot fake. */
const HEALTHY_UPTIME_MS = 30_000;

export function restartDelayFor(attempt: number): number {
  return Math.min(RESTART_BASE_DELAY_MS * 2 ** attempt, RESTART_MAX_DELAY_MS);
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

export class RestartPolicy {
  private attempts = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private healthyTimer?: ReturnType<typeof setTimeout>;
  private healthyGeneration = 0;
  private waiting: Promise<UtilityProcess> | null = null;
  private abandonWaiting: ((error: Error) => void) | null = null;
  private exhausted = false;

  /** Budget spent: no path may fork again. Checked wherever a fork can
   *  happen, not only on the exit path — the session poller sends a
   *  request a second, and an ordinary request must not be able to
   *  fork its own way around the cap. */
  get spent(): boolean {
    return this.exhausted;
  }

  /** The restart a backoff timer has armed but not yet performed.
   *  Everything that wants a worker during the dead-child window waits
   *  on this instead of forking: `request()` reaches `ensureChild()`
   *  from ordinary traffic, and forking there would skip the
   *  500ms/1s/2s spacing the backoff exists to impose. */
  get pending(): Promise<UtilityProcess> | null {
    return this.waiting;
  }

  /** The first message of a generation: the worker is answering, so
   *  start the clock on it proving itself. Later messages of the same
   *  generation change nothing, and a late message from an older,
   *  already-dead generation is ignored outright — a dead worker
   *  cannot vouch for anything. */
  noteMessage(generation: number): void {
    if (generation <= this.healthyGeneration) return;
    this.healthyGeneration = generation;
    clearTimeout(this.healthyTimer);
    this.healthyTimer = setTimeout(() => {
      this.attempts = 0;
    }, HEALTHY_UPTIME_MS);
    this.healthyTimer.unref?.();
  }

  /** A worker exited: it never reached `HEALTHY_UPTIME_MS`, so this
   *  crash still counts against the budget. */
  noteExit(): void {
    clearTimeout(this.healthyTimer);
    this.healthyTimer = undefined;
  }

  /** Arm the next restart, or spend the budget. `start` runs when the
   *  timer fires; `pending` resolves with whatever it produces. */
  schedule(start: () => Promise<UtilityProcess>): void {
    if (this.attempts >= MAX_RESTART_ATTEMPTS) {
      this.exhausted = true;
      return;
    }
    const delay = restartDelayFor(this.attempts);
    this.attempts += 1;
    const waiting = new Promise<UtilityProcess>((resolve, reject) => {
      this.abandonWaiting = reject;
      this.timer = setTimeout(() => {
        this.waiting = null;
        this.abandonWaiting = null;
        start().then(resolve, (error: unknown) => {
          // `utilityProcess.fork` can throw synchronously — resource
          // exhaustion after repeated restarts is exactly the state
          // this path runs in. Dropping that leaves an unhandled
          // rejection in main from the one path whose job is keeping
          // the app alive through worker flakiness; there is nothing
          // left to retry with, so the budget is spent.
          this.exhausted = true;
          reject(asError(error));
        });
      }, delay);
      this.timer.unref?.();
    });
    // Waiters see the rejection; this only keeps a restart nobody
    // happens to be waiting on from becoming an unhandled rejection.
    waiting.catch(() => undefined);
    this.waiting = waiting;
  }

  /** Shutdown: no more restarts, and anything waiting on one fails now
   *  rather than waiting on a timer that will never fire. */
  cancel(reason: Error): void {
    clearTimeout(this.timer);
    clearTimeout(this.healthyTimer);
    this.waiting = null;
    this.abandonWaiting?.(reason);
    this.abandonWaiting = null;
  }
}
