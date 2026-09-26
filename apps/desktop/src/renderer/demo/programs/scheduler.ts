/**
 * The clock every scripted program runs on. It only advances while the
 * demo plays, so pausing it (the page's pause button, or the demo
 * scrolling out of view) freezes every agent mid-sentence. Under
 * reduced motion the demo starts `instant`: programs lay out their end
 * state at once instead of scheduling anything.
 */
interface Task {
  at: number;
  fn: () => void;
  every?: number;
}

const TICK_MS = 50;

class Scheduler {
  instant = false;
  private now = 0;
  private playing = true;
  private tasks = new Set<Task>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.instant =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  setPlaying(playing: boolean): void {
    this.playing = playing;
  }

  /** Runs `fn` after `ms` of playing time; returns a cancel. */
  after(ms: number, fn: () => void): () => void {
    const task: Task = { at: this.now + ms, fn };
    this.tasks.add(task);
    return () => this.tasks.delete(task);
  }

  every(ms: number, fn: () => void): () => void {
    const task: Task = { at: this.now + ms, fn, every: ms };
    this.tasks.add(task);
    return () => this.tasks.delete(task);
  }

  private tick(): void {
    if (!this.playing || !this.timer) return;
    this.now += TICK_MS;
    for (const task of [...this.tasks]) {
      if (task.at > this.now || !this.tasks.has(task)) continue;
      if (task.every) task.at += task.every;
      else this.tasks.delete(task);
      task.fn();
    }
  }
}

export const scheduler = new Scheduler();
