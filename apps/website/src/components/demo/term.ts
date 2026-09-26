/**
 * Terminal text for the desktop demo. A line is a list of spans, each
 * with an optional tone; tones map to the `n10-t-*` classes in
 * global.css, which carry Claude Code's own colours and a zsh ANSI
 * palette for both site themes. No escape codes and no emulator: the
 * scripts are written in these terms directly.
 */
export type Tone =
  | 'dim'
  | 'bold'
  | 'code'
  | 'ok'
  | 'err'
  | 'green'
  | 'red'
  | 'yellow'
  | 'kw'
  | 'str'
  | 'num'
  | 'type'
  | 'fn';

export type Span = readonly [text: string, tone?: Tone | `${Tone} ${Tone}`];

/** A plain string is one untoned span. */
export type Line = string | readonly Span[];

export function spansOf(line: Line): readonly Span[] {
  return typeof line === 'string' ? [[line]] : line;
}

/**
 * Claude Code's markdown, as far as the scripts use it: `code` and
 * **bold**. Claude Code draws inline code in its "permission" blue
 * rather than with backticks.
 */
export function inline(text: string): Span[] {
  const spans: Span[] = [];
  const pattern = /`([^`]+)`|\*\*([^*]+)\*\*/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const at = match.index;
    if (at > last) spans.push([text.slice(last, at)]);
    spans.push(
      match[1] !== undefined ? [match[1], 'code'] : [match[2] ?? '', 'bold']
    );
    last = at + match[0].length;
  }
  if (last < text.length) spans.push([text.slice(last)]);
  return spans;
}

const KEYWORDS =
  'const|let|export|async|function|return|await|if|for|try|catch|throw|import|from|new|type|interface|typeof';

const TOKEN = new RegExp(
  [
    String.raw`(\/\/.*$)`,
    String.raw`('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")`,
    String.raw`\b(${KEYWORDS})\b`,
    String.raw`\b(\d[\d_]*)\b`,
    String.raw`\b([A-Z]\w*)\b`,
    String.raw`\b([a-z_$][\w$]*)(?=\()`,
  ].join('|'),
  'g'
);

const TOKEN_TONES: readonly Tone[] = ['dim', 'str', 'kw', 'num', 'type', 'fn'];

/** Enough TypeScript highlighting for a few lines of diff. */
export function highlight(code: string): Span[] {
  const spans: Span[] = [];
  let last = 0;
  for (const match of code.matchAll(TOKEN)) {
    const at = match.index;
    if (at > last) spans.push([code.slice(last, at)]);
    const group = match.slice(1).findIndex((g) => g !== undefined);
    spans.push([match[0], TOKEN_TONES[group]]);
    last = at + match[0].length;
  }
  if (last < code.length) spans.push([code.slice(last)]);
  return spans;
}
