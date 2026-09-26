import { paint, wrap, type Span, type Tone } from '../ansi.js';
import { highlight } from './highlight.js';

/**
 * Claude Code's transcript blocks and how it draws each one, matched
 * against v2.1 in a real terminal: the mascot banner, user turns on a
 * grey band, `● Tool(arg)` with results under `⎿`, numbered diffs with
 * the sign coloured and removed lines dimmed, and `●` paragraphs with
 * inline code in blue.
 */
export type Line = string | readonly Span[];

export interface DiffRow {
  n?: number;
  sign: '+' | '-' | ' ' | '…';
  code?: string;
}

export type Block =
  | { kind: 'banner'; cwd: string }
  | { kind: 'prompt'; text: string }
  | { kind: 'tool'; name: string; arg: string; out?: readonly Line[] }
  | { kind: 'read'; files: number }
  | {
      kind: 'edit';
      path: string;
      added: number;
      removed: number;
      rows: readonly DiffRow[];
    }
  | { kind: 'say'; paragraphs: readonly string[] }
  | { kind: 'done'; text: string }
  | { kind: 'interrupted' };

const GRAY: Tone[] = ['gray'];
const RESULT: Span[] = [['  ⎿  ', GRAY]];

const spansOf = (line: Line): readonly Span[] =>
  typeof line === 'string' ? [[line]] : line;

/** `code` and **bold**, as Claude Code renders its markdown. */
export function inline(text: string): Span[] {
  const spans: Span[] = [];
  let last = 0;
  for (const m of text.matchAll(/`([^`]+)`|\*\*([^*]+)\*\*/g)) {
    if (m.index > last) spans.push([text.slice(last, m.index)]);
    spans.push(m[1] !== undefined ? [m[1], ['bblue']] : [m[2] ?? '', ['bold']]);
    last = m.index + m[0].length;
  }
  if (last < text.length) spans.push([text.slice(last)]);
  return spans;
}

function banner(cwd: string): string[] {
  const logo = [' ▐▛███▜▌ ', '▝▜█████▛▘', '  ▘▘ ▝▝  '];
  const text: Span[][] = [
    [
      ['Claude Code', ['bold']],
      [' v2.1.283', GRAY],
    ],
    [['Opus 5.5 · Claude Max', GRAY]],
    [[cwd, GRAY]],
  ];
  return logo.map((mark, i) =>
    paint([[mark, ['bred']], ['   '], ...(text[i] ?? [])])
  );
}

function prompt(text: string, cols: number): string[] {
  return text
    .split('\n')
    .flatMap((para, i) =>
      wrap(
        [[para || ' ', ['white', 'userbg']]],
        cols,
        i === 0 ? [['❯ ', ['gray', 'userbg']]] : [['  ', ['userbg']]]
      )
    );
}

function results(out: readonly Line[], cols: number): string[] {
  return out.flatMap((line, i) =>
    wrap(spansOf(line), cols, i === 0 ? RESULT : [['     ']])
  );
}

function call(name: string, arg: string, cols: number): string[] {
  return wrap([[name, ['bold']], [`(${arg})`]], cols, [['● ', ['bgreen']]]);
}

/** A numbered diff row; wrapped code stays indented past the gutter. */
function diffRow(row: DiffRow, cols: number): string[] {
  if (row.sign === '…') return [paint([['     ...', GRAY]])];
  const num = String(row.n ?? '').padStart(8);
  const code = row.code ?? '';
  const indent = code.length - code.trimStart().length;
  const lead: Span[] = [
    row.sign === '+'
      ? [`${num} +`, ['bgreen']]
      : row.sign === '-'
      ? [`${num} -`, ['bred']]
      : [`${num}  `, ['dim', 'gray']],
    [code.slice(0, indent)],
  ];
  const body: Span[] =
    row.sign === '-'
      ? [[code.trimStart(), ['dim', 'gray']]]
      : highlight(code.trimStart());
  return wrap(body, cols, lead, 10 + indent);
}

function say(paragraphs: readonly string[], cols: number): string[] {
  return paragraphs.flatMap((p, i) => {
    const listed = /^\d+\./.test(p) && /^\d+\./.test(paragraphs[i - 1] ?? '');
    const gap = i > 0 && !listed ? [''] : [];
    const lead: Span[] = i === 0 ? [['● ', ['white']]] : [['  ']];
    return [...gap, ...wrap(inline(p), cols, lead)];
  });
}

function read(files: number): string {
  return paint([
    ['● ', ['bgreen']],
    ['Read ', GRAY],
    [String(files), ['bold']],
    [files === 1 ? ' file ' : ' files ', GRAY],
    ['(ctrl+o to expand)', GRAY],
  ]);
}

function edit(block: Extract<Block, { kind: 'edit' }>, cols: number): string[] {
  const lines = (n: number) => (n === 1 ? ' line' : ' lines');
  return [
    ...call('Update', block.path, cols),
    paint([
      ...RESULT,
      ['Added '],
      [String(block.added), ['bold']],
      [`${lines(block.added)}, removed `],
      [String(block.removed), ['bold']],
      [lines(block.removed)],
    ]),
    ...block.rows.flatMap((row) => diffRow(row, cols)),
  ];
}

export function renderBlock(block: Block, cols: number): string[] {
  switch (block.kind) {
    case 'banner':
      return banner(block.cwd);
    case 'prompt':
      return prompt(block.text, cols);
    case 'tool':
      return [
        ...call(block.name, block.arg, cols),
        ...results(block.out ?? [], cols),
      ];
    case 'read':
      return [read(block.files)];
    case 'edit':
      return edit(block, cols);
    case 'say':
      return say(block.paragraphs, cols);
    case 'done':
      return [paint([[`✻ ${block.text}`, GRAY]])];
    case 'interrupted':
      return [
        paint([
          ...RESULT,
          ['Interrupted', ['bred']],
          [' · What should Claude do instead?', GRAY],
        ]),
      ];
  }
}
