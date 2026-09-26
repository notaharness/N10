import type { Program, Tty } from '../../host/sessions.js';
import { ESC, LiveScreen, fit, type Span } from '../ansi.js';
import { scheduler } from '../scheduler.js';
import { renderBlock, type Block } from './blocks.js';

/**
 * A scripted Claude Code session. Beats play one after another on the
 * demo clock: each commits transcript blocks above the live region and
 * may start or stop the spinner, change the demo's state (a draft
 * comment, a resolved thread) or stop at a permission prompt that the
 * viewer answers from the keyboard. Once idle, whatever the viewer
 * types in the input box gets the script's reply.
 */
export interface Gate {
  command: string;
  why: string;
  options: readonly string[];
  reject: number;
}

export interface Beat {
  /** Playing time to wait after the previous beat. */
  after: number;
  blocks?: readonly Block[];
  /** Starts the spinner with this verb; null stops it. */
  working?: string | null;
  effect?: () => void;
  gate?: Gate;
}

export interface ClaudeScript {
  cwd: string;
  /** Transcript from before the page loaded, drawn at once. */
  history?: readonly Block[];
  beats?: readonly Beat[];
  /** The answer to a turn the viewer types. */
  reply?: (text: string) => readonly Beat[];
}

const GRAY = ['gray'] as const;
const SPIN = ['·', '✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳', '✢'];
const SPIN_MS = 120;

export class ClaudeCode implements Program {
  private tty!: Tty;
  private screen!: LiveScreen;
  private queue: Beat[] = [];
  private busy = false;
  private working: { verb: string; ms: number } | null = null;
  private stopSpin: (() => void) | null = null;
  private gate: Gate | null = null;
  private focus = 0;
  private buffer = '';
  private frame = 0;
  /** Every block drawn so far, to lay out again at a new width. */
  private transcript: { block: Block; gap: boolean }[] = [];

  constructor(private readonly script: ClaudeScript) {}

  start(tty: Tty): void {
    this.tty = tty;
    this.screen = new LiveScreen(tty);
    tty.write(ESC.hideCursor);
    this.commit([{ kind: 'banner', cwd: this.script.cwd }], false);
    this.commit(this.script.history ?? []);
    this.enqueue(this.script.beats ?? []);
  }

  /** Adds a turn, played once the current one is done. */
  enqueue(beats: readonly Beat[]): void {
    this.queue.push(...beats);
    if (!this.busy && !this.gate) this.next();
  }

  /** A turn typed into the conversation from outside (n10's plan). */
  say(text: string, beats: readonly Beat[]): void {
    this.commit([{ kind: 'prompt', text }]);
    this.enqueue(beats);
  }

  input(data: string): void {
    if (this.gate) this.answerKey(data);
    else this.type(data);
  }

  resize(): void {
    const cols = this.tty.cols;
    const lines = this.transcript.flatMap(({ block, gap }) => [
      ...(gap ? [''] : []),
      ...renderBlock(block, cols),
    ]);
    this.screen.reset(lines, this.live());
  }

  stop(): void {
    this.stopSpin?.();
    this.queue = [];
  }

  private next(): void {
    const beat = this.queue.shift();
    if (!beat) {
      this.busy = false;
      this.setWorking(null);
      return;
    }
    this.busy = true;
    if (scheduler.instant) this.apply(beat);
    else scheduler.after(beat.after, () => this.apply(beat));
  }

  private apply(beat: Beat): void {
    beat.effect?.();
    if (beat.working !== undefined) this.setWorking(beat.working);
    this.commit(beat.blocks ?? []);
    if (beat.gate) {
      this.gate = beat.gate;
      this.focus = 0;
      this.setWorking(null);
      this.busy = false;
      return;
    }
    this.next();
  }

  private setWorking(verb: string | null): void {
    if (verb && this.working?.verb === verb) return;
    this.working = verb ? { verb, ms: 0 } : null;
    this.tty.setActive(Boolean(verb));
    this.stopSpin?.();
    this.stopSpin = null;
    if (verb && !scheduler.instant) {
      this.stopSpin = scheduler.every(SPIN_MS, () => {
        this.frame += 1;
        if (this.working) this.working.ms += SPIN_MS;
        this.draw();
      });
    }
    this.draw();
  }

  private answerKey(data: string): void {
    const gate = this.gate as Gate;
    const digit = Number(data);
    if (digit >= 1 && digit <= gate.options.length) this.answer(digit - 1);
    else if (data === '\r') this.answer(this.focus);
    else if (data === '\x1b') this.answer(gate.reject);
    else if (data === '\x1b[A' || data === '\x1b[B') {
      const step = data === '\x1b[A' ? -1 : 1;
      this.focus =
        (this.focus + step + gate.options.length) % gate.options.length;
      this.draw();
    }
  }

  private answer(option: number): void {
    const gate = this.gate as Gate;
    this.gate = null;
    if (option === gate.reject) {
      this.queue = [];
      this.commit([{ kind: 'interrupted' }]);
      return;
    }
    this.draw();
    this.next();
  }

  private type(data: string): void {
    if (data === '\r') {
      const text = this.buffer.trim();
      this.buffer = '';
      if (text && !this.busy) this.say(text, this.script.reply?.(text) ?? []);
      else this.draw();
      return;
    }
    if (data === '\x7f') this.buffer = [...this.buffer].slice(0, -1).join('');
    else if (!data.startsWith('\x1b')) {
      this.buffer += [...data].filter((c) => c >= ' ').join('');
    }
    this.draw();
  }

  private commit(blocks: readonly Block[], gap = true): void {
    this.transcript.push(...blocks.map((block) => ({ block, gap })));
    const cols = this.tty.cols;
    const lines = blocks.flatMap((b) => [
      ...(gap ? [''] : []),
      ...renderBlock(b, cols),
    ]);
    this.screen.draw(lines, this.live());
  }

  private draw(): void {
    this.screen.draw([], this.live());
  }

  private live(): string[] {
    const cols = this.tty.cols;
    const rule = fit([['─'.repeat(cols), GRAY]], cols + 1);
    const top = this.working ? ['', this.spinner(cols), ''] : [''];
    if (this.gate) return [...top, rule, ...this.permission(cols)];
    const input: Span[] = this.buffer
      ? [['❯ '], [this.buffer], [' ', ['reverse']]]
      : [['❯ '], [' ', ['reverse']], ['Try "how does <filepath> work?"', GRAY]];
    return [
      ...top,
      rule,
      fit(input, cols),
      rule,
      fit(
        [
          ['  ⏵⏵ accept edits on', ['bmagenta']],
          [' (shift+tab to cycle)', GRAY],
        ],
        cols
      ),
    ];
  }

  private spinner(cols: number): string {
    const { verb, ms } = this.working as { verb: string; ms: number };
    const tokens = Math.round(ms / 25);
    const count =
      tokens < 1000 ? `${tokens}` : `${(tokens / 1000).toFixed(1)}k`;
    const glyph = scheduler.instant
      ? '✻'
      : SPIN[this.frame % SPIN.length] ?? '✻';
    return fit(
      [
        [glyph, ['bred']],
        [` ${verb}…`, ['byellow']],
        [
          ` (${Math.floor(ms / 1000)}s · ↓ ${count} tokens · esc to interrupt)`,
          GRAY,
        ],
      ],
      cols
    );
  }

  private permission(cols: number): string[] {
    const gate = this.gate as Gate;
    const row = (spans: Span[]) => fit([[' '], ...spans], cols);
    return [
      row([['Bash command', ['bold', 'bblue']]]),
      '',
      row([['  '], [gate.command]]),
      row([['  '], [gate.why, GRAY]]),
      '',
      row([['Do you want to proceed?']]),
      ...gate.options.map((option, i) =>
        i === this.focus
          ? row([[`❯ ${i + 1}. ${option}`, ['bblue']]])
          : row([[`  ${i + 1}. ${option}`]])
      ),
      '',
      row([['Esc to cancel · Tab to amend', GRAY]]),
    ];
  }
}
