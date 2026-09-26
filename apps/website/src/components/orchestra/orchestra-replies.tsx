/**
 * Real orchestrator replies from the scripted benchmark in
 * notaharness/plugins#8, quoted exactly: run #7 is the old guidance,
 * run #8 the new. Each side is a list because some replies are quoted
 * in parts. Add a pair by appending to `pairs`.
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
];

function Quotes({ label, lines }: { label: string; lines: string[] }) {
  return (
    <div className="min-w-0">
      <p className="text-fd-muted-foreground font-mono text-xs">{label}</p>
      {lines.map((line) => (
        <blockquote
          key={line}
          className="border-fd-border mt-1.5 border-l-2 pl-3 text-sm"
        >
          “{line}”
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
        Replies from a small scripted benchmark in a toy repository, before and
        after the guidance changed, quoted as written. One run of each, not a
        statistical comparison. Details in{' '}
        <a
          href="https://github.com/notaharness/plugins/pull/8"
          className="hover:text-fd-foreground underline decoration-fd-border underline-offset-4 transition-colors"
        >
          notaharness/plugins#8
        </a>
        .
      </p>
    </div>
  );
}
