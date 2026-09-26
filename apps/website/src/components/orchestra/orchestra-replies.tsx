/**
 * Real orchestrator replies from the scripted benchmarks in
 * notaharness/plugins#8 and #9, quoted exactly as those PRs record
 * them, backticks included; backticked spans render as code. Each side
 * is a list because some replies are quoted in parts.
 */
const pairs = [
  {
    moment: 'You approve one of four merges',
    before: [
      'The other three branches are waiting for your OK: feature/slugify, fix/parse-duration and feature/truncate.',
    ],
    after: [
      "Decision: should I merge fix/parse-duration next so main's tests pass? My default is yes. Slugify, truncate and the ellipsis question stay open until you pick them up.",
    ],
  },
  {
    moment: 'You answer only the ellipsis question',
    before: [
      "I haven't merged it because you only answered the default question.",
      'Two things still need your answer',
    ],
    after: [
      "I've asked the truncate player to make ‘…’ the default suffix and update the tests.",
      "Decision: should I merge fix/parse-duration into main now so main's tests pass again? My default is yes.",
    ],
  },
  {
    moment: 'You come back after ignoring the updates',
    before: [
      'OK to merge `fix/parse-duration` and `feature/truncate` into main? Both are finished, tests pass, and they change different files.',
    ],
    after: [
      '`truncate("hello world", 5)` returns "hell…"',
      'should slugs be ASCII-only ("cafe-uber") or keep Unicode letters ("café-über")?',
    ],
  },
];

/** Renders `backticked` spans as code, the rest as text. */
function withCode(line: string) {
  return line
    .split('`')
    .map((part, i) => (i % 2 === 1 ? <code key={part}>{part}</code> : part));
}

function Quotes({ label, lines }: { label: string; lines: string[] }) {
  return (
    <div className="min-w-0">
      <p className="text-fd-muted-foreground font-mono text-xs">{label}</p>
      {lines.map((line) => (
        <blockquote
          key={line}
          className="border-fd-border mt-1.5 border-l-2 pl-3 text-sm"
        >
          “{withCode(line)}”
        </blockquote>
      ))}
    </div>
  );
}

export function OrchestraReplies() {
  return (
    <div className="mt-8">
      <div className="space-y-4">
        {pairs.map(({ moment, before, after }) => (
          <div
            key={moment}
            className="border-fd-border bg-fd-card rounded-xl border p-4 sm:p-5"
          >
            <p className="text-sm font-medium">{moment}</p>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <Quotes label="Before" lines={before} />
              <Quotes label="After" lines={after} />
            </div>
          </div>
        ))}
      </div>
      <p className="text-fd-muted-foreground mt-3 text-xs text-pretty">
        Replies from small scripted benchmarks in a toy repository, before and
        after the guidance changed, quoted as written. One run of each, not a
        statistical comparison; the benchmark behind the last pair, where the
        user ignored the updates, came out mixed. Details in{' '}
        <a
          href="https://github.com/notaharness/plugins/pull/8"
          className="hover:text-fd-foreground underline decoration-fd-border underline-offset-4 transition-colors"
        >
          notaharness/plugins#8
        </a>{' '}
        and{' '}
        <a
          href="https://github.com/notaharness/plugins/pull/9"
          className="hover:text-fd-foreground underline decoration-fd-border underline-offset-4 transition-colors"
        >
          #9
        </a>
        .
      </p>
    </div>
  );
}
