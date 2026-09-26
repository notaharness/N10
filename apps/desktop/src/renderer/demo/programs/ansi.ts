import type { Tty } from '../host/sessions.js';

/**
 * Terminal output for the scripted programs, in the 16-colour SGR that
 * Claude Code itself emits under tmux (captured from v2.1), so the
 * desktop terminal's own palette decides how it looks in either theme.
 * Text is written as spans and wrapped here, with hanging indents, the
 * way Ink lays Claude Code out; only then is it turned into escapes.
 */
export type Tone =
  | 'gray'
  | 'dim'
  | 'bold'
  | 'white'
  | 'red'
  | 'green'
  | 'yellow'
  | 'blue'
  | 'magenta'
  | 'cyan'
  | 'bred'
  | 'bgreen'
  | 'byellow'
  | 'bblue'
  | 'bmagenta'
  | 'bcyan'
  | 'userbg'
  | 'reverse';

const SGR: Record<Tone, string> = {
  gray: '37',
  dim: '2',
  bold: '1',
  white: '97',
  red: '31',
  green: '32',
  yellow: '33',
  blue: '34',
  magenta: '35',
  cyan: '36',
  bred: '91',
  bgreen: '92',
  byellow: '93',
  bblue: '94',
  bmagenta: '95',
  bcyan: '96',
  userbg: '100',
  reverse: '7',
};

export type Span = readonly [text: string, tones?: readonly Tone[]];

export const ESC = {
  hideCursor: '\x1b[?25l',
  clearLine: '\r\x1b[2K',
  clearBelow: '\r\x1b[J',
  up: (n: number) => (n > 0 ? `\x1b[${n}A` : ''),
};

export function paint(spans: readonly Span[]): string {
  return spans
    .map(([text, tones]) =>
      tones?.length
        ? `\x1b[${tones.map((t) => SGR[t]).join(';')}m${text}\x1b[0m`
        : text
    )
    .join('');
}

const width = (spans: readonly Span[]) =>
  spans.reduce((n, [text]) => n + [...text].length, 0);

/** Split spans into words and the spaces between them, keeping tones. */
function tokens(spans: readonly Span[]): Span[] {
  return spans.flatMap(([text, tones]) =>
    text.split(/(\s+)/).flatMap((part) => (part ? [[part, tones] as Span] : []))
  );
}

/** Break a token longer than a whole line. */
function chop(token: Span, room: number): Span[] {
  const chars = [...token[0]];
  const out: Span[] = [];
  for (let i = 0; i < chars.length; i += room) {
    out.push([chars.slice(i, i + room).join(''), token[1]]);
  }
  return out;
}

/**
 * Word-wrap `spans` to `cols`, starting the first row with `lead` and
 * every further row with `indent` (spaces) — Claude Code's hanging
 * layout for `● ` and `⎿` blocks.
 */
export function wrap(
  spans: readonly Span[],
  cols: number,
  lead: readonly Span[] = [],
  indent = width(lead)
): string[] {
  const rows: Span[][] = [[...lead]];
  const room = Math.max(8, cols - indent - 1);
  for (const token of tokens(spans).flatMap((t) =>
    width([t]) > room ? chop(t, room) : [t]
  )) {
    const row = rows[rows.length - 1] as Span[];
    const used = width(row);
    const space = /^\s+$/.test(token[0]);
    if (used + width([token]) > cols - 1 && used > indent) {
      if (space) continue;
      rows.push([[' '.repeat(indent)], token]);
    } else {
      row.push(token);
    }
  }
  return rows.map(paint);
}

/** Cut a line to `cols` visible characters, for live rows that must
 *  never wrap (a wrapped row would break the redraw arithmetic). */
export function fit(spans: readonly Span[], cols: number): string {
  let left = Math.max(0, cols - 1);
  const kept: Span[] = [];
  for (const [text, tones] of spans) {
    const chars = [...text];
    if (chars.length <= left) {
      kept.push([text, tones]);
      left -= chars.length;
    } else {
      kept.push([chars.slice(0, left).join(''), tones]);
      break;
    }
  }
  return paint(kept);
}

/**
 * Ink's trick: lines above the live region are written once and scroll
 * away; the live region (spinner, input box, status) is redrawn in
 * place by moving up over it and clearing to the end of the screen.
 */
export class LiveScreen {
  private height = 0;

  constructor(private readonly tty: Tty) {}

  /** Starts over with `committed` and `live` as the whole screen. */
  reset(committed: readonly string[], live: readonly string[]): void {
    let out = ESC.hideCursor;
    for (const line of committed) out += `${line}\r\n`;
    out += live.join('\r\n');
    this.height = Math.max(0, live.length - 1);
    this.tty.redraw(out);
  }

  draw(committed: readonly string[], live: readonly string[]): void {
    let out = ESC.up(this.height) + ESC.clearBelow;
    for (const line of committed) out += `${line}\r\n`;
    out += live.join('\r\n');
    this.height = Math.max(0, live.length - 1);
    this.tty.write(out);
  }
}
