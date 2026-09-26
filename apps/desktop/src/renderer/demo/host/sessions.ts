import type {
  SessionActivitySnapshot,
  SessionDataEvent,
  SessionExitEvent,
} from '../../../host/contract.js';
import { Channel } from './hub.js';

/**
 * The demo's PTYs. Each session keeps everything it has written, which
 * is what `getSessionBuffer` replays into a terminal that mounts late,
 * and hands keystrokes to the program running in it. Programs are
 * scripted (programs/); none of them execute anything.
 */
export interface Program {
  /** Called once, with the session to write to. */
  start(tty: Tty): void;
  /** Keystrokes from the terminal, as the PTY would receive them. */
  input?(data: string): void;
  /** The pane was resized; programs that draw a live region redraw. */
  resize?(cols: number, rows: number): void;
  stop?(): void;
}

export interface Tty {
  write(data: string): void;
  /** Replaces everything on screen and in the replay buffer with
   *  `data`: a program re-laying itself out at a new width. */
  redraw(data: string): void;
  readonly cols: number;
  readonly rows: number;
  /** Marks the session busy or idle for the sidebar's activity dots. */
  setActive(active: boolean): void;
}

/** Where a session belongs: a worktree of a repository, or a terminal
 *  tab in a directory. */
export interface SessionMeta {
  repo: string | null;
  branch?: string;
  /** `'local'` or a beam peerId. */
  machine: string;
  terminal?: { kind: 'shell' | 'agent'; cwd: string };
}

export class DemoSession implements Tty {
  output = '';
  seq = 0;
  running = true;
  active = false;
  flashing = false;
  cols = 100;
  rows = 30;
  readonly spawnedAt = Date.now();

  constructor(
    readonly name: string,
    readonly program: Program,
    readonly meta: SessionMeta,
    private readonly hub: SessionHub
  ) {}

  start(): void {
    this.program.start(this);
  }

  write(data: string): void {
    this.output += data;
    this.seq += 1;
    this.hub.data.emit({ name: this.name, data, seq: this.seq });
  }

  redraw(data: string): void {
    this.output = '';
    this.write(`\x1b[H\x1b[2J\x1b[3J${data}`);
  }

  setActive(active: boolean): void {
    if (this.active && !active) this.flashing = true;
    this.active = active;
  }

  input(data: string): void {
    this.program.input?.(data);
  }

  resize(cols: number, rows: number): void {
    if (cols === this.cols && rows === this.rows) return;
    this.cols = cols;
    this.rows = rows;
    this.program.resize?.(cols, rows);
  }

  kill(): void {
    this.program.stop?.();
    this.running = false;
    this.active = false;
    this.hub.exit.emit({ name: this.name, code: 0, retained: true });
  }

  activity(): SessionActivitySnapshot {
    return {
      active: this.active,
      flashing: this.flashing,
      ...(this.running ? {} : { exited: true }),
    };
  }
}

export class SessionHub {
  readonly data = new Channel<SessionDataEvent>();
  readonly exit = new Channel<SessionExitEvent>();
  private readonly sessions = new Map<string, DemoSession>();

  get(name: string): DemoSession | undefined {
    return this.sessions.get(name);
  }

  all(): DemoSession[] {
    return [...this.sessions.values()];
  }

  /** Start `program` under `name`, replacing any session there. */
  spawn(
    name: string,
    program: Program,
    meta: SessionMeta,
    size?: { cols?: number; rows?: number }
  ): DemoSession {
    this.sessions.get(name)?.kill();
    const session = new DemoSession(name, program, meta, this);
    if (size?.cols && size.rows) {
      session.cols = size.cols;
      session.rows = size.rows;
    }
    this.sessions.set(name, session);
    session.start();
    return session;
  }

  forget(name: string): void {
    this.sessions.get(name)?.kill();
    this.sessions.delete(name);
  }
}
