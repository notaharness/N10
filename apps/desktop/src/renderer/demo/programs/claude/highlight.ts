import type { Span, Tone } from '../ansi.js';

/**
 * Enough TypeScript highlighting for a few lines of diff, in the
 * colours Claude Code's 16-colour theme uses: keywords in magenta or
 * cyan, numbers blue, types and calls yellow, the rest grey.
 */
const TOKEN = new RegExp(
  [
    String.raw`(\/\/.*$)`,
    String.raw`('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|\`[^\`]*\`)`,
    String.raw`\b(export|import|from|return|await|async|if|else|for|of|try|catch|throw|new|typeof)\b`,
    String.raw`\b(const|let|function|type|interface|class|true|false|null|undefined)\b`,
    String.raw`\b(\d[\d_]*)\b`,
    String.raw`\b([A-Z]\w*)\b`,
    String.raw`\b([a-z_$][\w$]*)(?=\()`,
  ].join('|'),
  'g'
);

const TONES: readonly Tone[][] = [
  ['dim', 'gray'],
  ['bgreen'],
  ['bmagenta'],
  ['bcyan'],
  ['bblue'],
  ['byellow'],
  ['byellow'],
];

export function highlight(code: string): Span[] {
  const spans: Span[] = [];
  let last = 0;
  for (const m of code.matchAll(TOKEN)) {
    if (m.index > last) spans.push([code.slice(last, m.index), ['gray']]);
    const group = m.slice(1).findIndex((g) => g !== undefined);
    spans.push([m[0], TONES[group] ?? ['gray']]);
    last = m.index + m[0].length;
  }
  if (last < code.length) spans.push([code.slice(last), ['gray']]);
  return spans;
}
